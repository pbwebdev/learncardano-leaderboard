"use server";

import { and, eq, gte, inArray, lte, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { partnerPayoutBatches, submissions, tasks, users } from "@/db/schema";
import { logChange } from "@/lib/audit";
import {
  formatCsv,
  groupForExport,
  isValidTxHash,
  type SubmissionForExport,
} from "@/lib/payouts";

function readString(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function parseDateMs(s: string): number | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Export winners — generates a payout CSV for `projectId`, optionally filtered
 * by a verifiedAt window. Selects verified-and-unbatched submissions, groups
 * per (user, asset), uploads CSV to R2 as `payouts/{batchId}/winners.csv`,
 * creates a `partner_payout_batches` row, links submissions via
 * `payoutBatchId` and flips them to `status='paid_pending'`. Redirects to
 * the batch detail page.
 */
export async function exportPayoutBatch(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const projectId = readString(formData, "projectId");
  if (!projectId) throw new Error("projectId_required");
  const fromMs = parseDateMs(readString(formData, "from"));
  const toMs = parseDateMs(readString(formData, "to"));

  const db = getDb();

  // verified-and-unbatched submissions for this project. Use payoutBatchId
  // IS NULL as the "unbatched" predicate — submissions move out of `verified`
  // into `paid_pending` once exported, but we additionally filter on
  // payoutBatchId NULL so a stuck `verified` row that's already linked never
  // double-exports.
  const where = [
    eq(submissions.status, "verified"),
    isNull(submissions.payoutBatchId),
    eq(tasks.projectId, projectId),
  ];
  if (fromMs != null) where.push(gte(submissions.verifiedAt, new Date(fromMs)));
  if (toMs != null) where.push(lte(submissions.verifiedAt, new Date(toMs)));

  const rows = await db
    .select({
      submissionId: submissions.id,
      userId: submissions.userId,
      verifiedAt: submissions.verifiedAt,
      taskPoints: tasks.points,
      tokenReward: tasks.tokenReward,
      paymentAddress: users.paymentAddress,
    })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .innerJoin(users, eq(users.stakeAddress, submissions.userId))
    .where(and(...where));

  if (rows.length === 0) {
    throw new Error("no_eligible_submissions");
  }

  const exportInput: SubmissionForExport[] = rows.map((r) => ({
    submissionId: r.submissionId,
    userId: r.userId,
    paymentAddress: r.paymentAddress ?? "",
    taskPoints: r.taskPoints,
    tokenReward: coerceTokenReward(r.tokenReward),
    verifiedAt: r.verifiedAt ? r.verifiedAt.getTime() : Date.now(),
  }));

  const grouped = groupForExport(exportInput);
  const csv = formatCsv(grouped);
  const totalAmount = grouped.reduce((acc, g) => acc + g.totalReward, 0);

  const batchId = crypto.randomUUID();
  const csvKey = `payouts/${batchId}/winners.csv`;

  const { env } = getCloudflareContext();
  const r2 = (env as unknown as { R2?: R2Bucket }).R2;
  if (!r2) throw new Error("r2_not_bound");
  await r2.put(csvKey, csv, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });

  await db.insert(partnerPayoutBatches).values({
    id: batchId,
    projectId,
    csvR2Key: csvKey,
    rowCount: grouped.length,
    totalAmount,
    recordedByUserId: adminId,
  });

  const submissionIds = rows.map((r) => r.submissionId);
  await db
    .update(submissions)
    .set({ status: "paid_pending", payoutBatchId: batchId })
    .where(inArray(submissions.id, submissionIds));

  await logChange({
    userId: adminId,
    entityType: "payout_batch",
    entityId: batchId,
    field: "_create",
    oldValue: null,
    newValue: { projectId, rowCount: grouped.length, submissionCount: submissionIds.length },
  });

  redirect(`/admin/payouts/${batchId}`);
}

function coerceTokenReward(raw: unknown): { policyId: string; assetName: string; quantity: number } | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const policyId = typeof o.policyId === "string" ? o.policyId : null;
  const assetName = typeof o.assetName === "string" ? o.assetName : null;
  const quantity = typeof o.quantity === "number" ? o.quantity : Number(o.quantity);
  if (!policyId || !assetName || !Number.isFinite(quantity) || quantity <= 0) return null;
  return { policyId, assetName, quantity };
}

/**
 * Record an on-chain tx hash for a previously-exported batch. Sets txHash,
 * paidAt=now, recordedByUserId=adminId. Moves all linked submissions to
 * status='paid'. The daily cron picks it up from here and verifies on-chain.
 */
export async function recordPayoutTxHash(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const batchId = readString(formData, "batchId");
  const txHash = readString(formData, "txHash").toLowerCase();
  if (!batchId) throw new Error("batchId_required");
  if (!isValidTxHash(txHash)) throw new Error("tx_hash_invalid");

  const db = getDb();
  const batch = (
    await db
      .select()
      .from(partnerPayoutBatches)
      .where(eq(partnerPayoutBatches.id, batchId))
      .limit(1)
  )[0];
  if (!batch) throw new Error("batch_not_found");
  if (batch.txHash) {
    // Already recorded — idempotent if same hash, refuse otherwise.
    if (batch.txHash.toLowerCase() === txHash) {
      redirect(`/admin/payouts/${batchId}`);
    }
    throw new Error("batch_already_has_tx");
  }

  await db
    .update(partnerPayoutBatches)
    .set({ txHash, paidAt: new Date(), recordedByUserId: adminId })
    .where(eq(partnerPayoutBatches.id, batchId));

  await db
    .update(submissions)
    .set({ status: "paid" })
    .where(and(eq(submissions.payoutBatchId, batchId), eq(submissions.status, "paid_pending")));

  await logChange({
    userId: adminId,
    entityType: "payout_batch",
    entityId: batchId,
    field: "tx_hash",
    oldValue: null,
    newValue: txHash,
  });

  redirect(`/admin/payouts/${batchId}`);
}
