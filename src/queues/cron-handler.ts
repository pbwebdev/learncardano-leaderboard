/**
 * Scheduled (cron) handler. Dispatches based on `event.cron` string declared
 * in `wrangler.jsonc`:
 *
 *   - "0 *\/6 * * *" → re-check active pool/drep delegation tasks for
 *     clawback (configured via `taskConfig.clawbackOnUndelegate`).
 *   - "5 * * * *"    → refresh the leaderboard KV cache.
 *   - "15 3 * * *"   → re-check active drep_registered tasks
 *     (retired/expired flips). Also verifies partner_payout_batches if
 *     the table exists (Phase 4 — TODO check in scope).
 *
 * Pattern: the scheduled handler hits the same Cardano façade as the queue
 * consumer. Both must run inside the OpenNext Cloudflare context — the
 * worker entry (`worker-entry.ts`) wraps each invocation in
 * `runWithCloudflareRequestContext` so `getCloudflareContext()` works.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";
import { pointsLedger, submissions, tasks, auditLog, partnerPayoutBatches } from "@/db/schema";
import { getAccountInfo, getDRepInfo, getTxInfo } from "@/lib/cardano";
import { refreshLeaderboardCache } from "@/lib/points";
import { parsePoolDelegationConfig, parseDRepDelegationConfig } from "@/lib/verification/delegation";
import { parseDRepRegisteredConfig } from "@/lib/verification/drep-activity";
import { drepIdFromStakeAddress } from "@/lib/stake-address";
import { compareCsvToTxOutputs, isWithinPaidAtWindow, parseCsv } from "@/lib/payouts";

interface CronEnv {
  DB: unknown;
  R2?: R2Bucket;
}

export async function handleScheduled(cron: string, env: CronEnv): Promise<void> {
  switch (cron) {
    case "0 */6 * * *":
      await reCheckDelegations(env);
      return;
    case "5 * * * *":
      await refreshLeaderboardCache(100);
      return;
    case "15 3 * * *":
      await reCheckDRepRegistrations(env);
      await verifyPendingPayoutBatches(env);
      return;
    default:
      console.warn("[cron] unhandled cron expression:", cron);
  }
}

// ---------- Delegation re-check (6h) ----------

async function reCheckDelegations(env: CronEnv) {
  const db = drizzle(env.DB as never, { schema });
  const delegationTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "active"),
        inArray(tasks.taskType, ["pool_delegation", "drep_delegation"]),
      ),
    );
  for (const task of delegationTasks) {
    let clawback = false;
    try {
      clawback = task.taskType === "pool_delegation"
        ? parsePoolDelegationConfig(task.taskConfig).clawbackOnUndelegate
        : parseDRepDelegationConfig(task.taskConfig).clawbackOnUndelegate;
    } catch {
      continue;
    }
    if (!clawback) continue;

    const verifiedSubs = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.taskId, task.id), eq(submissions.status, "verified")));
    for (const sub of verifiedSubs) {
      const account = await getAccountInfo(sub.userId);
      if (!account) continue; // provider failure — try next sweep
      const stillDelegated = task.taskType === "pool_delegation"
        ? !!account.delegated_pool && matchesPoolTarget(task.taskConfig, account.delegated_pool)
        : !!account.delegated_drep && matchesDRepTarget(task.taskConfig, account.delegated_drep);
      if (stillDelegated) continue;

      await applyClawback(db, sub.id, sub.userId, task.id, task.points, `clawback_${task.taskType}`);
    }
  }
}

function matchesPoolTarget(cfg: unknown, currentPool: string): boolean {
  try {
    const parsed = parsePoolDelegationConfig(cfg);
    return parsed.poolId == null || parsed.poolId === currentPool;
  } catch {
    return false;
  }
}

function matchesDRepTarget(cfg: unknown, currentDRep: string): boolean {
  try {
    const parsed = parseDRepDelegationConfig(cfg);
    if (parsed.drepId == null) {
      return currentDRep !== "drep_always_abstain" && currentDRep !== "drep_always_no_confidence";
    }
    return parsed.drepId === currentDRep;
  } catch {
    return false;
  }
}

// ---------- DRep registration re-check (24h) ----------

async function reCheckDRepRegistrations(env: CronEnv) {
  const db = drizzle(env.DB as never, { schema });
  const dRepTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "active"), eq(tasks.taskType, "drep_registered")));
  for (const task of dRepTasks) {
    let lastActiveBound: number | null = null;
    try {
      lastActiveBound = parseDRepRegisteredConfig(task.taskConfig).requireActiveLastEpochs;
    } catch {
      continue;
    }
    void lastActiveBound; // not used for clawback decision; we only check retired/expired here

    const verifiedSubs = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.taskId, task.id), eq(submissions.status, "verified")));
    for (const sub of verifiedSubs) {
      let drepId: string;
      try {
        drepId = drepIdFromStakeAddress(sub.userId);
      } catch {
        continue;
      }
      const drep = await getDRepInfo(drepId);
      if (!drep) continue;
      const stillActive = drep.drep_status !== "retired" && drep.expired !== true && drep.active !== false;
      if (!stillActive) {
        await applyClawback(db, sub.id, sub.userId, task.id, task.points, "clawback_drep_inactive");
      }
    }
  }
}

// ---------- Shared clawback helper ----------

async function applyClawback(
  db: ReturnType<typeof drizzle>,
  submissionId: string,
  userId: string,
  taskId: string,
  points: number,
  reason: string,
) {
  // Idempotent: only clawback if there isn't already a negative ledger row
  // tagged to this submission.
  const existing = await db
    .select({ id: pointsLedger.id })
    .from(pointsLedger)
    .where(and(eq(pointsLedger.submissionId, submissionId), sql`${pointsLedger.delta} < 0`))
    .limit(1);
  if (existing.length) return;

  if (points !== 0) {
    await db.insert(pointsLedger).values({
      userId,
      delta: -points,
      reason: "clawback",
      submissionId,
      note: reason,
    });
  }
  await db
    .update(submissions)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(submissions.id, submissionId));
  await db.insert(auditLog).values({
    userId: "system:cron",
    entityType: "submission",
    entityId: submissionId,
    field: "status",
    oldValue: "verified",
    newValue: `rejected:${reason}`,
  });
  console.log("[cron] clawback applied", { submissionId, taskId, points, reason });
}

// ---------- Partner payout batch on-chain verification (daily, 03:15 UTC) ----------

/**
 * For each partner_payout_batches row with txHash set + verifiedOnChain=0:
 *   1. Fetch tx via the Cardano façade.
 *   2. Confirm block_time is within ±24h of paidAt (sanity window).
 *   3. Read CSV from R2, reconcile every row against tx outputs.
 *   4. If all rows match → verifiedOnChain=1; submissions in this batch
 *      move 'paid' → 'reward_verified'; clear any stale discrepancy.
 *   5. On mismatch → write discrepancy_note. Submissions stay 'paid'.
 *      The admin UI surfaces the report for follow-up. We DO NOT throw —
 *      a single bad batch must not fail the entire cron tick.
 *
 * Uses the Cardano façade only (`getTxInfo`).
 */
async function verifyPendingPayoutBatches(env: CronEnv) {
  const db = drizzle(env.DB as never, { schema });
  const { env: cfEnv } = getCloudflareContext();
  const r2 = (cfEnv as unknown as { R2?: R2Bucket }).R2 ?? env.R2;
  if (!r2) {
    console.warn("[cron:payouts] R2 binding missing — skipping payout verification");
    return;
  }

  const pending = await db
    .select()
    .from(partnerPayoutBatches)
    .where(and(isNotNull(partnerPayoutBatches.txHash), eq(partnerPayoutBatches.verifiedOnChain, false)));
  if (pending.length === 0) return;

  console.log("[cron:payouts] verifying", { count: pending.length });
  for (const batch of pending) {
    try {
      await verifyOnePayoutBatch(db, r2, batch);
    } catch (e) {
      // Soft-fail: log + carry on with other batches. Next tick retries.
      console.warn("[cron:payouts] batch verification threw", batch.id, e);
    }
  }
}

async function verifyOnePayoutBatch(
  db: ReturnType<typeof drizzle>,
  r2: R2Bucket,
  batch: typeof partnerPayoutBatches.$inferSelect,
) {
  if (!batch.txHash) return; // belt and braces; the SQL already filtered

  const tx = await getTxInfo(batch.txHash);
  if (!tx) {
    // Provider failure — leave the batch alone, try next tick.
    console.warn("[cron:payouts] tx not found yet", batch.txHash.slice(0, 12));
    return;
  }

  const paidAtMs = batch.paidAt ? batch.paidAt.getTime() : null;
  if (paidAtMs != null && !isWithinPaidAtWindow(tx.block_time, paidAtMs)) {
    await applyDiscrepancy(
      db,
      batch.id,
      `tx block_time (${tx.block_time}) outside ±24h window of recorded paidAt (${paidAtMs}).`,
    );
    return;
  }

  // Fetch CSV from R2.
  const obj = await r2.get(batch.csvR2Key);
  if (!obj) {
    await applyDiscrepancy(db, batch.id, `csv missing from R2: ${batch.csvR2Key}`);
    return;
  }
  const csvText = await obj.text();
  let rows;
  try {
    rows = parseCsv(csvText);
  } catch (e) {
    await applyDiscrepancy(db, batch.id, `csv parse error: ${(e as Error).message}`);
    return;
  }

  const reconcile = compareCsvToTxOutputs(rows, tx);
  if (!reconcile.ok) {
    const note = JSON.stringify(reconcile.discrepancies, null, 2);
    await applyDiscrepancy(db, batch.id, note);
    return;
  }

  // Happy path: mark verified, clear any stale discrepancy, move submissions.
  await db
    .update(partnerPayoutBatches)
    .set({ verifiedOnChain: true, discrepancyNote: null })
    .where(eq(partnerPayoutBatches.id, batch.id));
  await db
    .update(submissions)
    .set({ status: "reward_verified" })
    .where(and(eq(submissions.payoutBatchId, batch.id), eq(submissions.status, "paid")));
  await db.insert(auditLog).values({
    userId: "system:cron",
    entityType: "payout_batch",
    entityId: batch.id,
    field: "verified_on_chain",
    oldValue: "false",
    newValue: "true",
  });
  console.log("[cron:payouts] batch verified on-chain", batch.id);
}

async function applyDiscrepancy(
  db: ReturnType<typeof drizzle>,
  batchId: string,
  note: string,
) {
  await db
    .update(partnerPayoutBatches)
    .set({ discrepancyNote: note })
    .where(eq(partnerPayoutBatches.id, batchId));
  await db.insert(auditLog).values({
    userId: "system:cron",
    entityType: "payout_batch",
    entityId: batchId,
    field: "discrepancy_note",
    oldValue: null,
    newValue: note.length > 500 ? note.slice(0, 500) + "…" : note,
  });
  console.warn("[cron:payouts] discrepancy recorded", batchId, note.slice(0, 200));
}
