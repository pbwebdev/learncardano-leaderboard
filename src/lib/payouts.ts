/**
 * Pure helpers for partner payout batches (Phase 4).
 *
 * - csvHeader / csvRow / formatCsv: emit the canonical payout CSV.
 * - parseCsv: read it back. Used by the on-chain verification cron
 *   to reconcile the CSV against the partner's payout tx outputs.
 * - compareCsvToTxOutputs: takes a parsed CSV + a TxInfo from the
 *   Cardano façade and returns either { ok: true } or a list of
 *   discrepancies for the admin UI to surface.
 *
 * CSV columns (CLAUDE.md § Payout flow):
 *   payment_address, stake_address, total_reward, asset, submission_ids, completed_at
 *
 * - total_reward is a number (lovelace for ADA; raw quantity for tokens).
 * - asset is "ADA" for lovelace payouts, otherwise "policyId.assetName" hex.
 * - submission_ids is a `|`-separated list (no commas — they'd break CSV).
 * - completed_at is ISO-8601 in UTC.
 *
 * Hand-rolled because the project bans extra deps. We don't need full RFC4180
 * because the inputs we emit are bech32 / hex / integers / |-separated UUIDs /
 * a single ISO timestamp — no embedded commas or quotes ever appear in the
 * data. parseCsv is forgiving on whitespace.
 */

import type { TxInfo, TxIo } from "@/lib/cardano/types";

export const PAYOUT_CSV_COLUMNS = [
  "payment_address",
  "stake_address",
  "total_reward",
  "asset",
  "submission_ids",
  "completed_at",
] as const;

export interface PayoutRow {
  paymentAddress: string;
  stakeAddress: string;
  totalReward: number;       // lovelace OR raw token quantity (integers in practice)
  asset: string;             // 'ADA' or 'policyId.assetName'
  submissionIds: string[];
  completedAt: string;       // ISO-8601 UTC
}

export const ADA_ASSET = "ADA";
export const LOVELACE_PER_ADA = 1_000_000;

export function csvHeader(): string {
  return PAYOUT_CSV_COLUMNS.join(",");
}

export function csvRow(row: PayoutRow): string {
  return [
    row.paymentAddress,
    row.stakeAddress,
    String(row.totalReward),
    row.asset,
    row.submissionIds.join("|"),
    row.completedAt,
  ].join(",");
}

export function formatCsv(rows: ReadonlyArray<PayoutRow>): string {
  return [csvHeader(), ...rows.map(csvRow)].join("\n") + "\n";
}

export function parseCsv(text: string): PayoutRow[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (col: string) => header.indexOf(col);
  const cols = {
    paymentAddress: idx("payment_address"),
    stakeAddress: idx("stake_address"),
    totalReward: idx("total_reward"),
    asset: idx("asset"),
    submissionIds: idx("submission_ids"),
    completedAt: idx("completed_at"),
  };
  for (const [name, i] of Object.entries(cols)) {
    if (i < 0) throw new Error(`csv_missing_column:${name}`);
  }
  const out: PayoutRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    const totalRewardRaw = parts[cols.totalReward];
    const totalReward = Number(totalRewardRaw);
    if (!Number.isFinite(totalReward)) throw new Error(`csv_bad_total_reward_on_row:${i}`);
    out.push({
      paymentAddress: parts[cols.paymentAddress],
      stakeAddress: parts[cols.stakeAddress],
      totalReward,
      asset: parts[cols.asset],
      submissionIds: parts[cols.submissionIds] ? parts[cols.submissionIds].split("|").filter(Boolean) : [],
      completedAt: parts[cols.completedAt],
    });
  }
  return out;
}

/**
 * Group submissions by user + reward asset for a single payout batch.
 * Caller passes per-submission rows joined to their tasks (`taskPoints`,
 * `tokenReward`). For ADA-points-only tasks we sum `taskPoints` and emit
 * lovelace = points × LOVELACE_PER_ADA in the CSV (the convention is
 * "1 point = 1 ADA" for the launch projects; partner can renegotiate per
 * task by setting tokenReward instead).
 *
 * Pure: no DB. Test inputs at the field boundary.
 */
export interface SubmissionForExport {
  submissionId: string;
  userId: string;             // bech32 stake address
  paymentAddress: string;     // user.paymentAddress (last seen)
  taskPoints: number;
  tokenReward: { policyId: string; assetName: string; quantity: number } | null;
  verifiedAt: number;         // ms
}

export function groupForExport(rows: ReadonlyArray<SubmissionForExport>): PayoutRow[] {
  // Key = `${stakeAddress}::${asset}` so a user with mixed ADA + token rewards
  // ends up on two CSV rows. Each group sums quantity and concatenates
  // submission IDs.
  const map = new Map<string, PayoutRow>();
  for (const s of rows) {
    const asset = s.tokenReward ? `${s.tokenReward.policyId}.${s.tokenReward.assetName}` : ADA_ASSET;
    const quantity = s.tokenReward ? s.tokenReward.quantity : s.taskPoints * LOVELACE_PER_ADA;
    const key = `${s.userId}::${asset}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalReward += quantity;
      existing.submissionIds.push(s.submissionId);
      // Keep the latest verifiedAt as the "completed_at" representative.
      const existingMs = Date.parse(existing.completedAt);
      const sMs = s.verifiedAt;
      if (!Number.isNaN(existingMs) && sMs > existingMs) {
        existing.completedAt = new Date(sMs).toISOString();
      }
    } else {
      map.set(key, {
        paymentAddress: s.paymentAddress,
        stakeAddress: s.userId,
        totalReward: quantity,
        asset,
        submissionIds: [s.submissionId],
        completedAt: new Date(s.verifiedAt).toISOString(),
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Reconcile a CSV against the on-chain tx outputs.
 *
 * For each CSV row, find tx outputs to `paymentAddress` whose asset bundle
 * includes the expected asset+quantity. ADA payouts check the lovelace
 * output; token payouts check the multi-asset bundle. Sum of matching
 * outputs must equal CSV totalReward.
 *
 * Returns `ok:true` when every CSV row has a matching set of outputs.
 * Otherwise `ok:false` with a `discrepancies` array suitable for surfacing
 * in the admin UI and storing in `partner_payout_batches.discrepancy_note`.
 */
export type ReconcileResult =
  | { ok: true }
  | { ok: false; discrepancies: ReadonlyArray<Discrepancy> };

export interface Discrepancy {
  stakeAddress: string;
  paymentAddress: string;
  asset: string;
  expected: number;
  actual: number;
  reason:
    | "no_output_to_recipient"
    | "amount_mismatch"
    | "missing_asset_in_bundle";
}

export function compareCsvToTxOutputs(rows: ReadonlyArray<PayoutRow>, tx: TxInfo): ReconcileResult {
  const discrepancies: Discrepancy[] = [];
  for (const row of rows) {
    const outputsToRecipient = tx.outputs.filter((o) => o.address === row.paymentAddress);
    if (outputsToRecipient.length === 0) {
      discrepancies.push({
        stakeAddress: row.stakeAddress,
        paymentAddress: row.paymentAddress,
        asset: row.asset,
        expected: row.totalReward,
        actual: 0,
        reason: "no_output_to_recipient",
      });
      continue;
    }
    const actual = sumAssetAcrossOutputs(outputsToRecipient, row.asset);
    if (actual === 0 && row.totalReward !== 0) {
      discrepancies.push({
        stakeAddress: row.stakeAddress,
        paymentAddress: row.paymentAddress,
        asset: row.asset,
        expected: row.totalReward,
        actual: 0,
        reason: "missing_asset_in_bundle",
      });
      continue;
    }
    if (actual !== row.totalReward) {
      discrepancies.push({
        stakeAddress: row.stakeAddress,
        paymentAddress: row.paymentAddress,
        asset: row.asset,
        expected: row.totalReward,
        actual,
        reason: "amount_mismatch",
      });
    }
  }
  if (discrepancies.length === 0) return { ok: true };
  return { ok: false, discrepancies };
}

function sumAssetAcrossOutputs(outputs: ReadonlyArray<TxIo>, asset: string): number {
  // Lovelace unit on Blockfrost is `lovelace`. On Koios it's also `lovelace`
  // (we normalise in the provider). For tokens the unit is `policyId+hexAssetName`.
  // We accept both `policyId.assetName` (our CSV format, dot-separated) and
  // the concatenated form to be defensive.
  let total = 0;
  const isAda = asset === ADA_ASSET;
  for (const o of outputs) {
    for (const a of o.amount) {
      if (isAda) {
        if (a.unit === "lovelace") total += Number(a.quantity);
      } else {
        const dotForm = asset;
        const concatForm = asset.replace(".", "");
        if (a.unit === dotForm || a.unit === concatForm) total += Number(a.quantity);
      }
    }
  }
  return total;
}

/**
 * Sanity-window check on the tx block_time vs the recorded paidAt. The cron
 * uses ±24h — partners shouldn't be recording a tx whose actual block time
 * is more than a day off from when they say they paid.
 */
export function isWithinPaidAtWindow(blockTimeSeconds: number | null, paidAtMs: number, windowMs = 24 * 60 * 60 * 1000): boolean {
  if (blockTimeSeconds == null) return false;
  const txMs = blockTimeSeconds * 1000;
  return Math.abs(txMs - paidAtMs) <= windowMs;
}

const TX_HASH_RE = /^[0-9a-f]{64}$/;
export function isValidTxHash(s: string): boolean {
  return TX_HASH_RE.test(s.trim().toLowerCase());
}
