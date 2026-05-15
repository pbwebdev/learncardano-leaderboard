"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentStakeAddress } from "@/lib/auth";
import { getDb } from "@/db/client";
import { submissions, tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { canSubmitForTask, validateProofInputs } from "@/lib/submissions";
import { checkUpload, proofR2Key } from "@/lib/uploads";

/**
 * Server action: submit a task. Phase 2 unifies the manual_review path with
 * the on-chain types (pool_delegation, drep_delegation, drep_registered,
 * tx_swap, asset_purchase, governance_vote).
 *
 * Flow:
 *   1. `getCurrentStakeAddress()` — throws not_authenticated if no session.
 *   2. Load the task. Validate eligibility (`canSubmitForTask`).
 *   3. Validate proof inputs vs task type (`validateProofInputs`):
 *      - manual_review: proofUrl + screenshot per taskConfig
 *      - tx_swap / asset_purchase: txHash regex
 *      - other on-chain: no proof required
 *   4. For manual: upload screenshot to R2 if present.
 *   5. INSERT submission with status=pending.
 *   6. For on-chain types: enqueue `{ submissionId }` to VERIFY_QUEUE.
 *   7. Log audit row.
 *   8. Redirect to `/projects/[slug]?submitted=<id>`.
 *
 * The unique index `(userId, taskId, txHash)` on submissions enforces
 * no-double-claim at the DB level. Catch the unique-violation error and
 * surface a clean `already_claimed:<txHash>` redirect param.
 */

const ON_CHAIN_TYPES = new Set([
  "pool_delegation",
  "drep_delegation",
  "drep_registered",
  "tx_swap",
  "asset_purchase",
  "governance_vote",
]);
const TX_HASH_TYPES = new Set(["tx_swap", "asset_purchase"]);

export async function submitTask(formData: FormData): Promise<void> {
  const userId = await getCurrentStakeAddress();
  const taskId = String(formData.get("taskId") ?? "");
  const projectSlug = String(formData.get("projectSlug") ?? "");
  if (!taskId || !projectSlug) throw new Error("missing_task_or_project");

  const db = getDb();
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0];
  if (!task) throw new Error("task_not_found");

  const priorSubs = await db
    .select({ userId: submissions.userId, taskId: submissions.taskId, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.userId, userId));
  const eligibility = canSubmitForTask({ task, priorSubmissions: priorSubs, now: Date.now() });
  if (!eligibility.ok) throw new Error(`ineligible:${eligibility.reason}`);

  const proofUrl = String(formData.get("proofUrl") ?? "").trim() || null;
  const txHashRaw = String(formData.get("txHash") ?? "").trim().toLowerCase() || null;
  const file = formData.get("screenshot");
  const hasScreenshot = file instanceof File && file.size > 0;

  const validation = validateProofInputs({
    taskType: task.taskType,
    taskConfig: task.taskConfig,
    proofUrl,
    hasScreenshot,
    txHash: txHashRaw,
  });
  if (!validation.ok) throw new Error(`bad_proof:${validation.field}:${validation.reason}`);

  const submissionId = crypto.randomUUID();
  let proofR2KeyValue: string | null = null;

  if (hasScreenshot && file instanceof File) {
    const guard = checkUpload({ size: file.size, type: file.type });
    if (!guard.ok) throw new Error(`bad_upload:${guard.reason}`);
    const key = proofR2Key({ userId, submissionId, ext: guard.ext });
    const { env } = getCloudflareContext();
    const r2 = (env as unknown as { R2?: R2Bucket }).R2;
    if (!r2) throw new Error("r2_not_bound");
    await r2.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: guard.mimetype },
    });
    proofR2KeyValue = key;
  }

  const txHashForRow = TX_HASH_TYPES.has(task.taskType) ? txHashRaw : null;

  try {
    await db.insert(submissions).values({
      id: submissionId,
      userId,
      taskId,
      status: "pending",
      proofUrl,
      proofR2Key: proofR2KeyValue,
      txHash: txHashForRow,
    });
  } catch (e) {
    // SQLite unique-index violation on (user_id, task_id, tx_hash). The
    // error text varies between drivers — match on "UNIQUE" / "unique".
    const msg = (e as Error).message ?? "";
    if (/unique/i.test(msg) && txHashForRow) {
      redirect(`/projects/${projectSlug}?already_claimed=${txHashForRow.slice(0, 16)}`);
    }
    throw e;
  }

  await logChange({
    userId,
    entityType: "submission",
    entityId: submissionId,
    field: "_create",
    oldValue: null,
    newValue: {
      taskId,
      taskType: task.taskType,
      hasProofUrl: !!proofUrl,
      hasScreenshot: !!proofR2KeyValue,
      hasTxHash: !!txHashForRow,
    },
  });

  // Enqueue for the on-chain types. manual_review stays pending until an
  // admin actions it from the queue page.
  if (ON_CHAIN_TYPES.has(task.taskType)) {
    const { env } = getCloudflareContext();
    const q = (env as unknown as { VERIFY_QUEUE?: { send(body: unknown): Promise<void> } }).VERIFY_QUEUE;
    if (q) {
      try {
        await q.send({ submissionId });
      } catch (e) {
        console.warn("[submit] queue send failed; submission stays pending", e);
      }
    } else {
      console.warn("[submit] VERIFY_QUEUE binding missing; submission stays pending");
    }
  }

  redirect(`/projects/${projectSlug}?submitted=${submissionId}`);
}

/**
 * Legacy alias for the Phase 1 form action name. The submit page now wires
 * through `submitTask` directly, but any cached server-action ID from a
 * pre-Phase-2 build will still POST here.
 */
export const submitManualReview = submitTask;

interface R2Bucket {
  put(key: string, body: ArrayBuffer | ReadableStream | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}
