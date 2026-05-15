"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { canEditProjectSlug } from "@/lib/submissions";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}[a-z0-9]$/;
const VALID_STATUSES = new Set(["draft", "active", "upcoming", "ended"]);
const VALID_CATEGORIES = new Set(["defi", "nft", "governance", "infra", "education", "gaming"]);

function readString(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function readDate(fd: FormData, key: string): Date | null {
  const v = readString(fd, key);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createProject(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "id").toLowerCase();
  const name = readString(formData, "name");
  if (!SLUG_RE.test(id)) throw new Error("invalid_slug");
  if (!name) throw new Error("name_required");
  const status = readString(formData, "status") || "draft";
  const category = readString(formData, "category") || "infra";
  if (!VALID_STATUSES.has(status)) throw new Error("invalid_status");
  if (!VALID_CATEGORIES.has(category)) throw new Error("invalid_category");

  const db = getDb();
  await db.insert(projects).values({
    id,
    name,
    description: readString(formData, "description"),
    websiteUrl: readString(formData, "websiteUrl") || null,
    referralUrl: readString(formData, "referralUrl") || null,
    category,
    status,
    displayOrder: Number(readString(formData, "displayOrder") || "0") || 0,
    campaignStartDate: readDate(formData, "campaignStartDate"),
  });
  await logChange({
    userId: adminId,
    entityType: "project",
    entityId: id,
    field: "_create",
    oldValue: null,
    newValue: { id, name, status, category },
  });
}

export async function updateProject(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const id = readString(formData, "id");
  if (!id) throw new Error("id_required");
  const db = getDb();
  const existing = (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
  if (!existing) throw new Error("project_not_found");

  // Slug edit gate: blocked if any submissions exist for any of this
  // project's tasks. Slug is the PK — we treat the form `slug` field as
  // a separate column for safety. In practice this UI doesn't expose
  // slug edits, but a hand-crafted POST would still be rejected.
  const newSlug = readString(formData, "newSlug");
  if (newSlug && newSlug !== id) {
    const subRows = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(submissions)
      .innerJoin(tasks, eq(tasks.id, submissions.taskId))
      .where(eq(tasks.projectId, id));
    const count = Number(subRows[0]?.n ?? 0);
    if (!canEditProjectSlug({ submissionCount: count })) throw new Error("slug_locked_submissions_exist");
    // Re-key project. SQLite allows this since FK enforcement on
    // tasks.project_id ON UPDATE NO ACTION; we manually update both.
    if (!SLUG_RE.test(newSlug)) throw new Error("invalid_slug");
    await db.update(tasks).set({ projectId: newSlug }).where(eq(tasks.projectId, id));
    await db.update(projects).set({ id: newSlug }).where(eq(projects.id, id));
    await logChange({ userId: adminId, entityType: "project", entityId: id, field: "id", oldValue: id, newValue: newSlug });
  }

  const targetId = newSlug || id;
  const changes: Record<string, string | number | null> = {};
  for (const f of ["name", "description", "websiteUrl", "referralUrl", "category", "status"] as const) {
    const next = readString(formData, f);
    if (next !== "" && next !== String(existing[f] ?? "")) {
      if (f === "status" && !VALID_STATUSES.has(next)) throw new Error("invalid_status");
      if (f === "category" && !VALID_CATEGORIES.has(next)) throw new Error("invalid_category");
      changes[f] = next;
    }
  }
  const order = Number(readString(formData, "displayOrder") || String(existing.displayOrder));
  if (order !== existing.displayOrder) changes["displayOrder"] = order;
  const csd = readDate(formData, "campaignStartDate");
  const prevCsd = existing.campaignStartDate ? existing.campaignStartDate.getTime() : null;
  if ((csd?.getTime() ?? null) !== prevCsd) changes["campaignStartDate"] = csd ? csd.getTime() : null;

  if (Object.keys(changes).length > 0) {
    await db.update(projects).set(changes).where(eq(projects.id, targetId));
    for (const [k, v] of Object.entries(changes)) {
      await logChange({
        userId: adminId,
        entityType: "project",
        entityId: targetId,
        field: k,
        oldValue: (existing as Record<string, unknown>)[k] ?? null,
        newValue: v,
      });
    }
  }
}

export async function bulkUpdateProjectStatus(formData: FormData): Promise<void> {
  const adminId = await requireAdmin();
  const status = readString(formData, "status");
  if (!VALID_STATUSES.has(status)) throw new Error("invalid_status");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  await getDb().update(projects).set({ status }).where(inArray(projects.id, ids));
  for (const id of ids) {
    await logChange({ userId: adminId, entityType: "project", entityId: id, field: "status", oldValue: null, newValue: status });
  }
}
