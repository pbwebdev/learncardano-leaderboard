/**
 * On-chain tx-hash verifiers: `tx_swap` + `asset_purchase`.
 *
 * User submits a tx hash. The verifier:
 *   1. Re-parses `taskConfig`.
 *   2. Validates the hash shape (64 hex chars).
 *   3. Loads tx via the Cardano façade.
 *   4. Confirms the tx involves the user's stake address (input).
 *   5. Confirms task-type-specific output conditions:
 *      - tx_swap: an output to one of `scriptAddresses`
 *      - asset_purchase: an output to a user-owned address containing the
 *        configured asset with the right quantity.
 *   6. Tx-age guard: `block_time >= task.startsAt` (epoch seconds).
 *   7. Confirmation guard: `num_confirmations > 0` else `needs_review`.
 *
 * The unique-index check (already-claimed) is enforced by the caller (queue
 * consumer) on `submissions(userId, taskId, txHash)`; the verifier doesn't
 * touch the DB itself.
 */

import { getTxInfo } from "@/lib/cardano";
import type { TxInfo, TxIo } from "@/lib/cardano";
import type { VerifierResult } from "./manual";

const TX_HASH_RE = /^[0-9a-f]{64}$/;

// ---------- Config parsers ----------

export type RedeemerTag = "spend" | "mint" | "cert" | "reward" | "vote" | "propose";

export interface RequiredMintedAsset {
  policyId: string;          // 56 hex chars, lowercase
  assetName: string | null;  // hex, lowercase; null = match any asset under policy
  minQuantity: number;       // default 1
}

export interface TxSwapConfig {
  scriptAddresses: string[]; // bech32 addresses (addr1...)
  minAdaIn: number | null;   // in ADA (not lovelace); verifier multiplies by 1e6
  // Optional strict-verification fields. Each is an AND with the rest when
  // configured. Hex values are normalised to lowercase by the parser so the
  // verifier compares apples to apples regardless of provider casing.
  requiredScriptHashes: string[] | null;          // each 56 hex chars
  requiredRedeemerTag: RedeemerTag | null;
  requiredRedeemerConstructor: number | null;     // non-negative integer
  requiredMintedAsset: RequiredMintedAsset | null;
  requiredReferenceScriptHash: string | null;     // 56 hex chars
  requiredOutputDatumHash: string | null;         // 64 hex chars
}

export interface AssetPurchaseConfig {
  policyId: string;           // 56-char hex
  assetName: string | null;   // hex; null = "any asset under this policy"
  minQuantity: number;        // default 1
}

export class TxHashConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`tx_hash_config:${field}:${message}`);
    this.name = "TxHashConfigError";
    this.field = field;
  }
}

export function parseTxSwapConfig(raw: unknown): TxSwapConfig {
  if (raw == null || typeof raw !== "object") {
    throw new TxHashConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const arr = obj.scriptAddresses;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new TxHashConfigError("scriptAddresses", "required, non-empty array of bech32 addresses");
  }
  const scriptAddresses: string[] = [];
  for (const a of arr) {
    if (typeof a !== "string" || !/^addr1[0-9a-z]+$/.test(a)) {
      throw new TxHashConfigError("scriptAddresses", "each entry must be a bech32 address (addr1...)");
    }
    scriptAddresses.push(a);
  }
  let minAdaIn: number | null = null;
  if (obj.minAdaIn !== undefined && obj.minAdaIn !== null) {
    if (typeof obj.minAdaIn !== "number" || !Number.isFinite(obj.minAdaIn) || obj.minAdaIn < 0) {
      throw new TxHashConfigError("minAdaIn", "must be a non-negative number (ADA)");
    }
    minAdaIn = obj.minAdaIn;
  }

  // ---- Optional strict-verification fields ----
  const HEX56 = /^[0-9a-f]{56}$/;
  const HEX64 = /^[0-9a-f]{64}$/;
  const HEX_ANY = /^[0-9a-f]*$/;
  const REDEEMER_TAGS = new Set<RedeemerTag>(["spend", "mint", "cert", "reward", "vote", "propose"]);

  let requiredScriptHashes: string[] | null = null;
  if (obj.requiredScriptHashes !== undefined && obj.requiredScriptHashes !== null) {
    if (!Array.isArray(obj.requiredScriptHashes)) {
      throw new TxHashConfigError("requiredScriptHashes", "must be an array of 56-char hex strings");
    }
    const list: string[] = [];
    for (const h of obj.requiredScriptHashes) {
      if (typeof h !== "string") {
        throw new TxHashConfigError("requiredScriptHashes", "each entry must be a string");
      }
      const lower = h.toLowerCase();
      if (!HEX56.test(lower)) {
        throw new TxHashConfigError("requiredScriptHashes", "each entry must be 56 hex chars");
      }
      list.push(lower);
    }
    if (list.length > 0) requiredScriptHashes = list;
  }

  let requiredRedeemerTag: RedeemerTag | null = null;
  if (obj.requiredRedeemerTag !== undefined && obj.requiredRedeemerTag !== null && obj.requiredRedeemerTag !== "") {
    const v = String(obj.requiredRedeemerTag).toLowerCase();
    if (!REDEEMER_TAGS.has(v as RedeemerTag)) {
      throw new TxHashConfigError("requiredRedeemerTag", "must be one of spend|mint|cert|reward|vote|propose");
    }
    requiredRedeemerTag = v as RedeemerTag;
  }

  let requiredRedeemerConstructor: number | null = null;
  if (obj.requiredRedeemerConstructor !== undefined && obj.requiredRedeemerConstructor !== null) {
    if (
      typeof obj.requiredRedeemerConstructor !== "number" ||
      !Number.isInteger(obj.requiredRedeemerConstructor) ||
      obj.requiredRedeemerConstructor < 0
    ) {
      throw new TxHashConfigError("requiredRedeemerConstructor", "must be a non-negative integer");
    }
    requiredRedeemerConstructor = obj.requiredRedeemerConstructor;
  }

  let requiredMintedAsset: RequiredMintedAsset | null = null;
  if (obj.requiredMintedAsset !== undefined && obj.requiredMintedAsset !== null) {
    const m = obj.requiredMintedAsset;
    if (typeof m !== "object") {
      throw new TxHashConfigError("requiredMintedAsset", "must be an object");
    }
    const mm = m as Record<string, unknown>;
    const pid = typeof mm.policyId === "string" ? mm.policyId.toLowerCase() : "";
    if (!HEX56.test(pid)) {
      throw new TxHashConfigError("requiredMintedAsset.policyId", "must be 56 hex chars");
    }
    let assetName: string | null = null;
    if (mm.assetName !== undefined && mm.assetName !== null && mm.assetName !== "") {
      if (typeof mm.assetName !== "string" || !HEX_ANY.test(mm.assetName.toLowerCase())) {
        throw new TxHashConfigError("requiredMintedAsset.assetName", "must be a hex string");
      }
      assetName = mm.assetName.toLowerCase();
    }
    let minQuantity = 1;
    if (mm.minQuantity !== undefined && mm.minQuantity !== null) {
      if (typeof mm.minQuantity !== "number" || !Number.isInteger(mm.minQuantity) || mm.minQuantity < 1) {
        throw new TxHashConfigError("requiredMintedAsset.minQuantity", "must be a positive integer");
      }
      minQuantity = mm.minQuantity;
    }
    requiredMintedAsset = { policyId: pid, assetName, minQuantity };
  }

  let requiredReferenceScriptHash: string | null = null;
  if (obj.requiredReferenceScriptHash !== undefined && obj.requiredReferenceScriptHash !== null && obj.requiredReferenceScriptHash !== "") {
    const v = String(obj.requiredReferenceScriptHash).toLowerCase();
    if (!HEX56.test(v)) {
      throw new TxHashConfigError("requiredReferenceScriptHash", "must be 56 hex chars");
    }
    requiredReferenceScriptHash = v;
  }

  let requiredOutputDatumHash: string | null = null;
  if (obj.requiredOutputDatumHash !== undefined && obj.requiredOutputDatumHash !== null && obj.requiredOutputDatumHash !== "") {
    const v = String(obj.requiredOutputDatumHash).toLowerCase();
    if (!HEX64.test(v)) {
      throw new TxHashConfigError("requiredOutputDatumHash", "must be 64 hex chars");
    }
    requiredOutputDatumHash = v;
  }

  return {
    scriptAddresses,
    minAdaIn,
    requiredScriptHashes,
    requiredRedeemerTag,
    requiredRedeemerConstructor,
    requiredMintedAsset,
    requiredReferenceScriptHash,
    requiredOutputDatumHash,
  };
}

export function parseAssetPurchaseConfig(raw: unknown): AssetPurchaseConfig {
  if (raw == null || typeof raw !== "object") {
    throw new TxHashConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const policyId = obj.policyId;
  if (typeof policyId !== "string" || !/^[0-9a-f]{56}$/.test(policyId)) {
    throw new TxHashConfigError("policyId", "must be a 56-char hex string");
  }
  let assetName: string | null = null;
  if (obj.assetName !== undefined && obj.assetName !== null && obj.assetName !== "") {
    if (typeof obj.assetName !== "string" || !/^[0-9a-f]*$/.test(obj.assetName)) {
      throw new TxHashConfigError("assetName", "must be a hex string");
    }
    assetName = obj.assetName;
  }
  let minQuantity = 1;
  if (obj.minQuantity !== undefined && obj.minQuantity !== null) {
    if (typeof obj.minQuantity !== "number" || !Number.isInteger(obj.minQuantity) || obj.minQuantity < 1) {
      throw new TxHashConfigError("minQuantity", "must be a positive integer");
    }
    minQuantity = obj.minQuantity;
  }
  return { policyId, assetName, minQuantity };
}

// ---------- Verifier surface ----------

export interface TxHashVerifyOpts {
  taskType: "tx_swap" | "asset_purchase";
  taskConfig: unknown;
  task: { startsAt?: Date | number | null };
  user: { stakeAddress: string };
  submission: { txHash?: string | null };
}

export async function verifyTxHash(opts: TxHashVerifyOpts): Promise<VerifierResult> {
  const txHash = (opts.submission.txHash ?? "").trim().toLowerCase();
  if (!TX_HASH_RE.test(txHash)) {
    return { status: "rejected", reason: "invalid_tx_hash" };
  }
  const tx = await getTxInfo(txHash);
  if (!tx) {
    // Not on-chain yet OR both providers down. Treat as needs_review — the
    // queue retry will resolve once the tx settles. Unconfirmed retries
    // don't get long-cached at the provider level (TTL gating in koios.ts).
    return { status: "needs_review", reason: "tx_unknown_or_unconfirmed" };
  }
  if (tx.num_confirmations <= 0) {
    return { status: "needs_review", reason: "unconfirmed" };
  }

  // Tx-age guard. block_time is unix seconds; task.startsAt is JS ms.
  const startMs = toMillis(opts.task.startsAt);
  if (startMs != null && tx.block_time != null && tx.block_time * 1000 < startMs) {
    return { status: "rejected", reason: "tx_before_task_started" };
  }

  // User-ownership: confirm at least one input came from a UTxO whose stake
  // credential matches the user. Providers populate `stake_address` on
  // inputs/outputs when they can decode it from the payment address; when
  // they can't, we fall back to a stake_addresses[] tx-level check.
  if (!txInvolvesStake(tx, opts.user.stakeAddress)) {
    return { status: "rejected", reason: "tx_not_owned_by_user" };
  }

  if (opts.taskType === "tx_swap") {
    return verifyTxSwap(opts, tx);
  }
  return verifyAssetPurchase(opts, tx);
}

function verifyTxSwap(opts: TxHashVerifyOpts, tx: TxInfo): VerifierResult {
  const cfg = parseTxSwapConfig(opts.taskConfig);
  const scriptSet = new Set(cfg.scriptAddresses);
  const hitsScript = tx.outputs.some((o) => scriptSet.has(o.address));
  if (!hitsScript) {
    return { status: "rejected", reason: "no_output_to_script_address" };
  }
  if (cfg.minAdaIn != null) {
    const minLovelace = Math.floor(cfg.minAdaIn * 1_000_000);
    const userIn = sumUserLovelace(tx.inputs, opts.user.stakeAddress);
    if (userIn < minLovelace) {
      return { status: "rejected", reason: "user_input_below_min_ada" };
    }
  }

  // ---- Strict-verification (optional) ----
  const contracts = tx.plutusContracts;

  if (cfg.requiredScriptHashes && cfg.requiredScriptHashes.length > 0) {
    if (!contracts) {
      return { status: "needs_review", reason: "provider_data_missing:plutusContracts" };
    }
    const want = new Set(cfg.requiredScriptHashes);
    if (!contracts.some((c) => want.has(c.scriptHash))) {
      return { status: "rejected", reason: "script_hash_not_present" };
    }
  }

  if (cfg.requiredRedeemerTag) {
    if (!contracts) {
      return { status: "needs_review", reason: "provider_data_missing:plutusContracts" };
    }
    const tagged = contracts.filter((c) => c.redeemerTag !== undefined);
    if (tagged.length === 0) {
      return { status: "needs_review", reason: "provider_data_missing:redeemerTag" };
    }
    if (!tagged.some((c) => c.redeemerTag === cfg.requiredRedeemerTag)) {
      return { status: "rejected", reason: "redeemer_tag_mismatch" };
    }
  }

  if (cfg.requiredRedeemerConstructor != null) {
    if (!contracts) {
      return { status: "needs_review", reason: "provider_data_missing:plutusContracts" };
    }
    const decoded = contracts.filter((c) => c.redeemerConstructor !== undefined);
    if (decoded.length === 0) {
      return { status: "needs_review", reason: "provider_data_missing:redeemerConstructor" };
    }
    if (!decoded.some((c) => c.redeemerConstructor === cfg.requiredRedeemerConstructor)) {
      return { status: "rejected", reason: "redeemer_constructor_mismatch" };
    }
  }

  if (cfg.requiredMintedAsset) {
    if (!tx.mintedAssets) {
      return { status: "needs_review", reason: "provider_data_missing:mintedAssets" };
    }
    const m = cfg.requiredMintedAsset;
    const ok = tx.mintedAssets.some(
      (a) =>
        a.policyId === m.policyId &&
        (m.assetName == null || a.assetName === m.assetName) &&
        a.quantity >= m.minQuantity,
    );
    if (!ok) {
      return { status: "rejected", reason: "minted_asset_not_present" };
    }
  }

  if (cfg.requiredReferenceScriptHash) {
    if (!tx.referenceInputs) {
      return { status: "needs_review", reason: "provider_data_missing:referenceInputs" };
    }
    if (!tx.referenceInputs.some((r) => r.scriptHash === cfg.requiredReferenceScriptHash)) {
      return { status: "rejected", reason: "reference_script_not_attached" };
    }
  }

  if (cfg.requiredOutputDatumHash) {
    if (!tx.outputDatums) {
      return { status: "needs_review", reason: "provider_data_missing:outputDatums" };
    }
    if (!tx.outputDatums.some((o) => o.datumHash === cfg.requiredOutputDatumHash)) {
      return { status: "rejected", reason: "output_datum_hash_mismatch" };
    }
  }

  return { status: "verified" };
}

function verifyAssetPurchase(opts: TxHashVerifyOpts, tx: TxInfo): VerifierResult {
  const cfg = parseAssetPurchaseConfig(opts.taskConfig);
  const unitPrefix = cfg.policyId;
  // Walk outputs that the user appears to control (by stake_address match).
  // Sum the matching asset quantity across all such outputs.
  let totalQty = 0;
  for (const out of tx.outputs) {
    if (out.stake_address !== opts.user.stakeAddress) continue;
    for (const a of out.amount) {
      if (a.unit === "lovelace") continue;
      const policy = a.unit.slice(0, 56);
      const assetName = a.unit.slice(56);
      if (policy !== unitPrefix) continue;
      if (cfg.assetName != null && assetName !== cfg.assetName) continue;
      totalQty += Number(a.quantity);
    }
  }
  if (totalQty < cfg.minQuantity) {
    return { status: "rejected", reason: "asset_quantity_below_min" };
  }
  return { status: "verified" };
}

// ---------- Helpers ----------

function toMillis(d: Date | number | null | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  return d.getTime();
}

/**
 * True when any tx input / output / tx-level stake_addresses entry equals
 * the user's stake address. Providers vary: Koios resolves stake addresses
 * on each IO; Blockfrost doesn't (we'd need a second `/addresses/{addr}`
 * lookup to map back). The tx-level `stake_addresses` array catches the
 * withdrawal / delegation cases; the per-IO field catches the spend case.
 */
function txInvolvesStake(tx: TxInfo, stakeAddress: string): boolean {
  if (tx.stake_addresses?.includes(stakeAddress)) return true;
  for (const io of tx.inputs) if (io.stake_address === stakeAddress) return true;
  for (const io of tx.outputs) if (io.stake_address === stakeAddress) return true;
  return false;
}

function sumUserLovelace(ios: TxIo[], stakeAddress: string): number {
  let total = 0;
  for (const io of ios) {
    if (io.stake_address !== stakeAddress) continue;
    for (const a of io.amount) {
      if (a.unit === "lovelace") total += Number(a.quantity);
    }
  }
  return total;
}
