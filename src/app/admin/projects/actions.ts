"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { canEditProjectSlug } from "@/lib/submissions";
import { ShortIoNotConfiguredError, createShortLink, isShortIoConfigured } from "@/lib/short-io";

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
  const referralUrl = readString(formData, "referralUrl") || null;
  await db.insert(projects).values({
    id,
    name,
    description: readString(formData, "description"),
    websiteUrl: readString(formData, "websiteUrl") || null,
    referralUrl,
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

  if (referralUrl) {
    await syncProjectShortLink(id, referralUrl, adminId);
  }
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
  for (const f of ["name", "description", "websiteUrl", "referralUrl", "category", "status", "partnerNotes"] as const) {
    const next = readString(formData, f);
    if (next !== String(existing[f] ?? "")) {
      if (f === "status" && next !== "" && !VALID_STATUSES.has(next)) throw new Error("invalid_status");
      if (f === "category" && next !== "" && !VALID_CATEGORIES.has(next)) throw new Error("invalid_category");
      // Allow clearing partnerNotes by passing "" — stored as null.
      // Other fields keep the legacy "skip on empty" semantics so a
      // half-filled form doesn't wipe real data.
      if (f === "partnerNotes") changes[f] = next === "" ? null : next;
      else if (next !== "") changes[f] = next;
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

  // If the admin set/changed referralUrl, sync the Dub link (non-fatal).
  const finalReferral = typeof changes["referralUrl"] === "string"
    ? (changes["referralUrl"] as string)
    : (existing.referralUrl ?? null);
  if (finalReferral) {
    await syncProjectShortLink(targetId, finalReferral, adminId);
  }
}

/**
 * Create-or-update the project's Short.io link. Non-fatal: any Short.io
 * failure is logged and surfaced as an audit entry but does NOT abort
 * the project save (per the brief).
 *
 * Short.io has no client-side `externalId` concept (unlike Dub), so we
 * lean on `allowDuplicates: false` in the create call — re-POSTing the
 * same destination returns the existing link, which makes a fresh create
 * idempotent on the (originalURL, domain) tuple. When the referralUrl
 * changes for an existing project we create a brand-new short link
 * rather than mutate the old one (mutating destinations across
 * already-shared links would surprise partners); the old link id remains
 * in the audit log via the dub_link change row below.
 */
async function syncProjectShortLink(projectId: string, referralUrl: string, adminId: string): Promise<void> {
  if (!isShortIoConfigured()) {
    // Silent skip — admin can rerun the save after secrets are set.
    return;
  }
  const db = getDb();
  const existing = (await db.select({ dubLinkId: projects.dubLinkId, shortUrl: projects.shortUrl, referralUrl: projects.referralUrl }).from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  // If the project already has a short link AND the referral URL hasn't
  // changed, there's nothing to do.
  if (existing?.dubLinkId && existing.referralUrl === referralUrl) return;
  try {
    const link = await createShortLink({
      originalURL: referralUrl,
      externalId: `project:${projectId}`,
      tags: ["leaderboard", `project:${projectId}`],
    });
    await db.update(projects).set({ dubLinkId: link.id, shortUrl: link.shortURL }).where(eq(projects.id, projectId));
    await logChange({
      userId: adminId,
      entityType: "project",
      entityId: projectId,
      field: "dub_link",
      oldValue: existing?.shortUrl ?? null,
      newValue: link.shortURL,
    });
  } catch (e) {
    if (e instanceof ShortIoNotConfiguredError) return;
    console.warn("[admin:projects] short-io sync failed", e instanceof Error ? e.message : e);
    await logChange({
      userId: adminId,
      entityType: "project",
      entityId: projectId,
      field: "short_link_sync_error",
      oldValue: null,
      newValue: e instanceof Error ? e.message : String(e),
    });
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
