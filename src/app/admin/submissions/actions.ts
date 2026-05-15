"use server";

import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { submissions, tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { appendPoints } from "@/lib/points";
import { isPayoutLockedStatus } from "@/lib/submissions";

function readString(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/**
 * Approve a pending submission. Sets status='verified', verifiedAt=now(),
 * appends a positive ledger row of `task.points` with reason='task_verified',
 * and logs the status change. Idempotent: re-running on an already-verified
 * submission is a no-op.
 */
export async function approveSubmission(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "submissionId");
  if (!id) throw new Error("submissionId_required");
  const db = getDb();
  const subRow = (await db.select().from(submissions).where(eq(submissions.id, id)).limit(1))[0];
  if (!subRow) throw new Error("submission_not_found");
  if (subRow.status === "verified") return; // idempotent
  if (isPayoutLockedStatus(subRow.status)) {
    // Submission is already in a payout batch — admin must unlink the
    // batch row first. We refuse here so a stray click can't desync the
    // ledger from the on-chain payout.
    throw new Error(`submission_in_payout_batch:${subRow.status}`);
  }

  const taskRow = (await db.select().from(tasks).where(eq(tasks.id, subRow.taskId)).limit(1))[0];
  if (!taskRow) throw new Error("task_not_found");

  const now = new Date();
  await db
    .update(submissions)
    .set({ status: "verified", verifiedAt: now, rejectionReason: null })
    .where(eq(submissions.id, id));
  if (taskRow.points !== 0) {
    await appendPoints({
      userId: subRow.userId,
      delta: taskRow.points,
      reason: "task_verified",
      submissionId: id,
      note: `approved by ${adminId.slice(0, 12)}…`,
    });
  }
  await logChange({
    userId: adminId,
    entityType: "submission",
    entityId: id,
    field: "status",
    oldValue: subRow.status,
    newValue: "verified",
  });
}

export async function rejectSubmission(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "submissionId");
  const reason = readString(formData, "rejectionReason");
  if (!id) throw new Error("submissionId_required");
  if (!reason) throw new Error("rejection_reason_required");
  const db = getDb();
  const subRow = (await db.select().from(submissions).where(eq(submissions.id, id)).limit(1))[0];
  if (!subRow) throw new Error("submission_not_found");
  if (isPayoutLockedStatus(subRow.status)) {
    throw new Error(`submission_in_payout_batch:${subRow.status}`);
  }

  await db
    .update(submissions)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(submissions.id, id));
  // If this submission had previously been approved (admin changing their
  // mind), append a clawback row.
  if (subRow.status === "verified") {
    const taskRow = (await db.select().from(tasks).where(eq(tasks.id, subRow.taskId)).limit(1))[0];
    if (taskRow && taskRow.points !== 0) {
      await appendPoints({
        userId: subRow.userId,
        delta: -taskRow.points,
        reason: "clawback",
        submissionId: id,
        note: `rejected on re-review: ${reason.slice(0, 100)}`,
      });
    }
  }
  await logChange({
    userId: adminId,
    entityType: "submission",
    entityId: id,
    field: "status",
    oldValue: subRow.status,
    newValue: "rejected",
  });
  await logChange({
    userId: adminId,
    entityType: "submission",
    entityId: id,
    field: "rejection_reason",
    oldValue: subRow.rejectionReason,
    newValue: reason,
  });
}

export async function addSubmissionNote(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "submissionId");
  const note = readString(formData, "note");
  if (!id) throw new Error("submissionId_required");
  const db = getDb();
  const subRow = (await db.select().from(submissions).where(eq(submissions.id, id)).limit(1))[0];
  if (!subRow) throw new Error("submission_not_found");
  await db.update(submissions).set({ notes: note || null }).where(eq(submissions.id, id));
  await logChange({
    userId: adminId,
    entityType: "submission",
    entityId: id,
    field: "notes",
    oldValue: subRow.notes,
    newValue: note,
  });
}
