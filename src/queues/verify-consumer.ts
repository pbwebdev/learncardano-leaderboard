/**
 * Queue consumer for on-chain submission verification.
 *
 * Triggered by Cloudflare Queues when a submission is enqueued from
 * `/projects/[slug]/tasks/[taskId]/submit/actions.ts` or
 * `/api/verify/[id]/route.ts`.
 *
 * Each message: `{ submissionId: string }`.
 *
 * Per message:
 *   1. Load submission + task + user from D1.
 *   2. If status already in {verified, paid, reward_verified}, ack (no-op).
 *   3. Flip to status='verifying'.
 *   4. Run the dispatcher.
 *   5. If verified → append pointsLedger, set status, audit log.
 *      If rejected → set status + rejectionReason, audit log.
 *      If needs_review → throw so Cloudflare retries (per max_retries).
 *   6. Any thrown error bubbles to the batch handler, which marks the
 *      submission rejected with `verifier_unavailable` after the final
 *      retry — actually, the platform redelivers the message and we
 *      only know it's "final" after `attempts >= max_retries`. We rely
 *      on the `attempts` field on the message envelope (Cloudflare Queues
 *      provides it) to make that call.
 *
 * The consumer never imports verifiers directly — it goes through the
 * verification dispatcher (`src/lib/verification/index.ts`).
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { submissions, tasks, auditLog, pointsLedger, users } from "@/db/schema";
import { verify, type VerifierResult } from "@/lib/verification";

export interface VerifyJob {
  submissionId: string;
}

interface ConsumerEnv {
  DB: D1Database;
}

// Cloudflare Queues message envelope. The runtime types live in
// @cloudflare/workers-types (devDependency) but we keep a minimal shim
// here so the consumer compiles cleanly without that lib in tsconfig.
interface QueueMessage<T> {
  id: string;
  timestamp: Date;
  body: T;
  attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

interface MessageBatch<T> {
  queue: string;
  messages: QueueMessage<T>[];
  ackAll(): void;
  retryAll(opts?: { delaySeconds?: number }): void;
}

interface D1Database {
  // intentionally loose — we only pass it into drizzle().
  [k: string]: unknown;
}

const MAX_ATTEMPTS = 3;

export async function handleVerifyQueue(batch: MessageBatch<VerifyJob>, env: ConsumerEnv): Promise<void> {
  const db = drizzle(env.DB as never, { schema });
  for (const msg of batch.messages) {
    const submissionId = msg.body?.submissionId;
    if (!submissionId) {
      console.warn("[queue:verify] empty message body, acking", msg.id);
      msg.ack();
      continue;
    }
    try {
      await processOne(db, submissionId, msg.attempts);
      msg.ack();
    } catch (e) {
      // Per CLAUDE.md § Verification flow: 3 retries, then mark
      // verifier_unavailable. msg.attempts is 1 on first delivery.
      const attempts = msg.attempts ?? 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.error("[queue:verify] giving up after", attempts, "attempts:", submissionId, e);
        try {
          await markVerifierUnavailable(db, submissionId);
        } catch (markErr) {
          console.error("[queue:verify] failed to mark unavailable", submissionId, markErr);
        }
        msg.ack();
      } else {
        console.warn("[queue:verify] retrying", submissionId, "attempt", attempts, e);
        msg.retry({ delaySeconds: Math.min(60, 5 * attempts) });
      }
    }
  }
}

async function processOne(db: ReturnType<typeof drizzle>, submissionId: string, _attempts: number) {
  const sub = (await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!sub) {
    console.warn("[queue:verify] submission not found:", submissionId);
    return;
  }
  if (sub.status === "verified" || sub.status === "paid" || sub.status === "reward_verified") {
    return; // idempotent
  }
  const task = (await db.select().from(tasks).where(eq(tasks.id, sub.taskId)).limit(1))[0];
  if (!task) {
    console.warn("[queue:verify] task not found:", sub.taskId);
    return;
  }

  if (sub.status !== "verifying") {
    await db.update(submissions).set({ status: "verifying" }).where(eq(submissions.id, submissionId));
  }

  // OAuth verifiers need the user's linked-account fields. Cheap one-shot
  // select — we already round-tripped to D1 twice above, this is the third.
  const userRow = (await db.select({
    xUserId: users.xUserId,
    xAccessTokenEnc: users.xAccessTokenEnc,
    youtubeChannelId: users.youtubeChannelId,
    youtubeAccessTokenEnc: users.youtubeAccessTokenEnc,
  }).from(users).where(eq(users.stakeAddress, sub.userId)).limit(1))[0];

  const result: VerifierResult = await verify({
    taskType: task.taskType,
    taskConfig: task.taskConfig,
    task: { startsAt: task.startsAt, endsAt: task.endsAt },
    user: {
      stakeAddress: sub.userId,
      xUserId: userRow?.xUserId ?? null,
      xAccessTokenEnc: userRow?.xAccessTokenEnc ?? null,
      youtubeChannelId: userRow?.youtubeChannelId ?? null,
      youtubeAccessTokenEnc: userRow?.youtubeAccessTokenEnc ?? null,
    },
    submission: { proofUrl: sub.proofUrl, proofR2Key: sub.proofR2Key, txHash: sub.txHash },
  });

  if (result.status === "needs_review") {
    // Treat as upstream-unavailable and let the queue retry — throw so the
    // catch-and-retry path runs.
    throw new Error(`needs_review:${result.reason ?? "unknown"}`);
  }

  if (result.status === "verified") {
    await db
      .update(submissions)
      .set({ status: "verified", verifiedAt: new Date(), rejectionReason: null })
      .where(eq(submissions.id, submissionId));
    if (task.points !== 0) {
      await db.insert(pointsLedger).values({
        userId: sub.userId,
        delta: task.points,
        reason: "task_verified",
        submissionId,
        note: `auto-verified:${task.taskType}`,
      });
    }
    await db.insert(auditLog).values({
      userId: "system:verifier",
      entityType: "submission",
      entityId: submissionId,
      field: "status",
      oldValue: sub.status,
      newValue: "verified",
    });
    return;
  }

  // rejected
  await db
    .update(submissions)
    .set({ status: "rejected", rejectionReason: result.reason })
    .where(eq(submissions.id, submissionId));
  await db.insert(auditLog).values({
    userId: "system:verifier",
    entityType: "submission",
    entityId: submissionId,
    field: "status",
    oldValue: sub.status,
    newValue: "rejected",
  });
  await db.insert(auditLog).values({
    userId: "system:verifier",
    entityType: "submission",
    entityId: submissionId,
    field: "rejection_reason",
    oldValue: null,
    newValue: result.reason ?? "verifier_rejected",
  });
}

async function markVerifierUnavailable(db: ReturnType<typeof drizzle>, submissionId: string) {
  const sub = (await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1))[0];
  if (!sub) return;
  if (sub.status === "verified") return; // raced
  await db
    .update(submissions)
    .set({ status: "rejected", rejectionReason: "verifier_unavailable" })
    .where(eq(submissions.id, submissionId));
  await db.insert(auditLog).values({
    userId: "system:verifier",
    entityType: "submission",
    entityId: submissionId,
    field: "status",
    oldValue: sub.status,
    newValue: "rejected:verifier_unavailable",
  });
}
