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

import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { pointsLedger, submissions, tasks, auditLog } from "@/db/schema";
import { getAccountInfo, getDRepInfo } from "@/lib/cardano";
import { refreshLeaderboardCache } from "@/lib/points";
import { parsePoolDelegationConfig, parseDRepDelegationConfig } from "@/lib/verification/delegation";
import { parseDRepRegisteredConfig } from "@/lib/verification/drep-activity";
import { drepIdFromStakeAddress } from "@/lib/stake-address";

interface CronEnv {
  DB: unknown;
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
