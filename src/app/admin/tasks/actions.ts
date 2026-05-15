"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { ALL_TASK_TYPES, isAdminCreatableTaskType, parseTaskConfigByType } from "@/lib/verification";

const VALID_STATUSES = new Set(["draft", "active", "paused", "ended"]);

function readString(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function readDate(fd: FormData, key: string): Date | null {
  const v = readString(fd, key);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function readInt(fd: FormData, key: string, fallback: number): number {
  const v = readString(fd, key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function readBool(fd: FormData, key: string): boolean {
  return readString(fd, key) === "on";
}

function readIntOrUndef(fd: FormData, key: string): number | undefined {
  const v = readString(fd, key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function readCsv(fd: FormData, key: string): string[] {
  return readString(fd, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readLines(fd: FormData, key: string): string[] {
  return readString(fd, key)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Assemble the typed taskConfig object from cfg_* FormData fields, then
 * route through the central parseTaskConfigByType dispatcher for the
 * verifier-specific Zod-style validation. Throws on invalid input
 * (caller surfaces as a 500 with the underlying error message).
 */
function buildTaskConfig(formData: FormData, taskType: string): unknown {
  switch (taskType) {
    case "manual_review":
      return parseTaskConfigByType(taskType, {
        instructions: readString(formData, "cfg_instructions"),
        requiresProofUrl: readBool(formData, "cfg_requiresProofUrl"),
        requiresScreenshot: readBool(formData, "cfg_requiresScreenshot"),
      });
    case "pool_delegation":
      return parseTaskConfigByType(taskType, {
        poolId: readString(formData, "cfg_poolId") || undefined,
        clawbackOnUndelegate: readBool(formData, "cfg_clawbackOnUndelegate"),
      });
    case "drep_delegation":
      return parseTaskConfigByType(taskType, {
        drepId: readString(formData, "cfg_drepId") || undefined,
        mustBeActive: readBool(formData, "cfg_mustBeActive"),
      });
    case "drep_registered":
      return parseTaskConfigByType(taskType, {
        requireActiveLastEpochs: readIntOrUndef(formData, "cfg_requireActiveLastEpochs"),
      });
    case "tx_swap":
      return parseTaskConfigByType(taskType, {
        scriptAddresses: readLines(formData, "cfg_scriptAddresses"),
        minAdaIn: readIntOrUndef(formData, "cfg_minAdaIn"),
      });
    case "asset_purchase":
      return parseTaskConfigByType(taskType, {
        policyId: readString(formData, "cfg_policyId"),
        assetName: readString(formData, "cfg_assetName") || undefined,
        minQuantity: readIntOrUndef(formData, "cfg_minQuantity"),
      });
    case "governance_vote":
      return parseTaskConfigByType(taskType, {
        actionTxHash: readString(formData, "cfg_actionTxHash") || undefined,
      });
    case "x_tweet":
      return parseTaskConfigByType(taskType, {
        requiredHashtags: readCsv(formData, "cfg_requiredHashtags"),
        requiredMentions: readCsv(formData, "cfg_requiredMentions"),
      });
    case "x_retweet":
      return parseTaskConfigByType(taskType, {
        targetTweetId: readString(formData, "cfg_targetTweetId"),
      });
    case "youtube_comment":
      return parseTaskConfigByType(taskType, {
        videoId: readString(formData, "cfg_videoId"),
      });
    case "bounty_completion":
      return parseTaskConfigByType(taskType, {
        bountyId: readString(formData, "cfg_bountyId"),
      });
    default:
      throw new Error(`unknown_task_type:${taskType}`);
  }
}

export async function createTask(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const projectId = readString(formData, "projectId");
  const title = readString(formData, "title");
  const taskType = readString(formData, "taskType");
  if (!projectId) throw new Error("projectId_required");
  if (!title) throw new Error("title_required");
  if (!ALL_TASK_TYPES.includes(taskType as (typeof ALL_TASK_TYPES)[number])) throw new Error("invalid_task_type");
  if (!isAdminCreatableTaskType(taskType as "manual_review")) throw new Error("task_type_not_admin_creatable");

  const taskConfig = buildTaskConfig(formData, taskType);
  const id = crypto.randomUUID();

  const status = readString(formData, "status") || "draft";
  if (!VALID_STATUSES.has(status)) throw new Error("invalid_status");

  await getDb().insert(tasks).values({
    id,
    projectId,
    title,
    descriptionMd: readString(formData, "descriptionMd"),
    taskType,
    taskConfig,
    verificationMethod: "manual",
    points: readInt(formData, "points", 0),
    startsAt: readDate(formData, "startsAt"),
    endsAt: readDate(formData, "endsAt"),
    maxCompletionsPerUser: readInt(formData, "maxCompletionsPerUser", 1),
    totalCompletionCap: readInt(formData, "totalCompletionCap", 0),
    displayOrder: readInt(formData, "displayOrder", 0),
    status,
  });
  await logChange({
    userId: adminId,
    entityType: "task",
    entityId: id,
    field: "_create",
    oldValue: null,
    newValue: { projectId, title, taskType, status },
  });
  redirect(`/admin/tasks/${id}?created=1`);
}

export async function updateTask(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "id");
  if (!id) throw new Error("id_required");
  const db = getDb();
  const existing = (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
  if (!existing) throw new Error("task_not_found");

  const taskType = readString(formData, "taskType") || existing.taskType;
  if (!isAdminCreatableTaskType(taskType as "manual_review")) throw new Error("task_type_not_admin_creatable");

  const status = readString(formData, "status") || existing.status;
  if (!VALID_STATUSES.has(status)) throw new Error("invalid_status");

  const taskConfig = buildTaskConfig(formData, taskType);

  const changes: Record<string, unknown> = {
    title: readString(formData, "title") || existing.title,
    descriptionMd: readString(formData, "descriptionMd"),
    taskType,
    taskConfig,
    points: readInt(formData, "points", existing.points),
    startsAt: readDate(formData, "startsAt"),
    endsAt: readDate(formData, "endsAt"),
    maxCompletionsPerUser: readInt(formData, "maxCompletionsPerUser", existing.maxCompletionsPerUser),
    totalCompletionCap: readInt(formData, "totalCompletionCap", existing.totalCompletionCap),
    displayOrder: readInt(formData, "displayOrder", existing.displayOrder),
    status,
  };

  await db.update(tasks).set(changes).where(eq(tasks.id, id));
  // We log the full new value as a single field for brevity — admin audit
  // page renders it as JSON.
  await logChange({
    userId: adminId,
    entityType: "task",
    entityId: id,
    field: "_update",
    oldValue: { title: existing.title, status: existing.status, points: existing.points },
    newValue: { title: changes.title, status: changes.status, points: changes.points },
  });
  redirect(`/admin/tasks/${id}?saved=1`);
}
