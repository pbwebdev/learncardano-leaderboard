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
 * Server action: submit a manual_review proof.
 *
 * Flow:
 *   1. `getCurrentStakeAddress()` — throws not_authenticated if no session.
 *   2. Load the task. Validate eligibility (`canSubmitForTask`).
 *   3. Validate proof inputs against `task.taskConfig` (re-parsed).
 *   4. If a screenshot is attached, gate it via `checkUpload` and PUT to
 *      R2 at `submissions/${userId}/${submissionId}/proof.${ext}`.
 *   5. INSERT submission row with status=pending.
 *   6. Log audit row.
 *   7. Redirect to /projects/[slug] (the SaveForm full-reload handles the
 *      UX otherwise; redirect is fine here because the submission page
 *      is single-shot).
 *
 * R2 PUT happens server-side via env.R2.put — no presigned URL needed.
 * Cap 5 MB, PNG/JPEG/WEBP only (uploads.ts).
 */
export async function submitManualReview(formData: FormData): Promise<void> {
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
  const file = formData.get("screenshot");
  const hasScreenshot = file instanceof File && file.size > 0;

  const validation = validateProofInputs({
    taskConfig: task.taskConfig,
    proofUrl,
    hasScreenshot,
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

  await db.insert(submissions).values({
    id: submissionId,
    userId,
    taskId,
    status: "pending",
    proofUrl,
    proofR2Key: proofR2KeyValue,
  });
  await logChange({
    userId,
    entityType: "submission",
    entityId: submissionId,
    field: "_create",
    oldValue: null,
    newValue: { taskId, hasProofUrl: !!proofUrl, hasScreenshot: !!proofR2KeyValue },
  });

  redirect(`/projects/${projectSlug}?submitted=${submissionId}`);
}

/**
 * Minimal R2 binding type for the env shim — we don't pull
 * @cloudflare/workers-types in here since the global type is provided by
 * the auto-generated cloudflare-env.d.ts (gitignored). This type-only
 * declaration keeps the action type-clean without that file.
 */
interface R2Bucket {
  put(key: string, body: ArrayBuffer | ReadableStream | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}
