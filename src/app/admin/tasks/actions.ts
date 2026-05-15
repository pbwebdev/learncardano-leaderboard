"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { ALL_TASK_TYPES, isTaskTypeEnabledInPhase1 } from "@/lib/verification";
import { parseManualReviewConfig } from "@/lib/verification/manual";

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

function buildTaskConfig(formData: FormData, taskType: string): unknown {
  if (taskType === "manual_review") {
    const cfg = {
      instructions: readString(formData, "cfg_instructions"),
      requiresProofUrl: readBool(formData, "cfg_requiresProofUrl"),
      requiresScreenshot: readBool(formData, "cfg_requiresScreenshot"),
    };
    // Throws ManualReviewConfigError on invalid input.
    return parseManualReviewConfig(cfg);
  }
  throw new Error(`unsupported_task_type_phase1:${taskType}`);
}

export async function createTask(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const projectId = readString(formData, "projectId");
  const title = readString(formData, "title");
  const taskType = readString(formData, "taskType");
  if (!projectId) throw new Error("projectId_required");
  if (!title) throw new Error("title_required");
  if (!ALL_TASK_TYPES.includes(taskType as (typeof ALL_TASK_TYPES)[number])) throw new Error("invalid_task_type");
  if (!isTaskTypeEnabledInPhase1(taskType as "manual_review")) throw new Error("task_type_disabled_phase1");

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
  redirect(`/admin/tasks/${id}`);
}

export async function updateTask(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "id");
  if (!id) throw new Error("id_required");
  const db = getDb();
  const existing = (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
  if (!existing) throw new Error("task_not_found");

  const taskType = readString(formData, "taskType") || existing.taskType;
  if (!isTaskTypeEnabledInPhase1(taskType as "manual_review")) throw new Error("task_type_disabled_phase1");

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
}
