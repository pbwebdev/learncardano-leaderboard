import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { tasks, projects, users } from "@/db/schema";
import { renderProfileCard, renderTaskCard } from "@/lib/share-card";
import { getPointsFor, getVerifiedCountFor, getProjectsEngagedFor } from "@/lib/points";
import { looksLikeStakeAddress } from "@/lib/stake-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open Graph share-card endpoint.
 *
 *   /og/profile/<stakeAddress>  →  per-user card
 *   /og/task/<taskId>           →  per-task card
 *
 * Cached in R2 under `share-cards/<kind>/<id>.svg`. Cache miss → render
 * + persist. Cache hit → stream the stored SVG. Public, no auth.
 *
 * Cache invalidation is intentionally external — admin task edits and
 * point changes will eventually call `deleteShareCard` to purge. For
 * v1 we accept stale cards on profile-points changes; scrapers re-fetch
 * on user-triggered share so the staleness window is small.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "profile" && kind !== "task") {
    return new Response("not_found", { status: 404 });
  }

  const { env } = getCloudflareContext();
  const r2 = (env as { R2?: { get: (k: string) => Promise<{ body: ReadableStream } | null>; put: (k: string, v: string, opts?: unknown) => Promise<unknown> } }).R2;
  const cacheKey = `share-cards/${kind}/${encodeURIComponent(id)}.svg`;

  if (r2) {
    const hit = await r2.get(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=300",
        },
      });
    }
  }

  let svg: string;
  if (kind === "profile") {
    if (!looksLikeStakeAddress(id)) return new Response("not_found", { status: 404 });
    const db = getDb();
    const u = (await db.select({ stake: users.stakeAddress, vis: users.profileVisibility }).from(users).where(eq(users.stakeAddress, id)).limit(1))[0];
    if (!u || u.vis !== "public") return new Response("not_found", { status: 404 });
    const [points, verified, projectsEngaged] = await Promise.all([
      getPointsFor(id),
      getVerifiedCountFor(id),
      getProjectsEngagedFor(id),
    ]);
    svg = renderProfileCard({
      stakeAddress: id,
      points,
      verified,
      projectsEngaged,
    });
  } else {
    const db = getDb();
    const row = (await db
      .select({ title: tasks.title, points: tasks.points, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, id))
      .limit(1))[0];
    if (!row) return new Response("not_found", { status: 404 });
    svg = renderTaskCard({ projectName: row.projectName, taskTitle: row.title, points: row.points });
  }

  if (r2) {
    try {
      await r2.put(cacheKey, svg, {
        httpMetadata: { contentType: "image/svg+xml" },
      });
    } catch (e) {
      console.warn("[og] r2 put failed", e instanceof Error ? e.message : e);
    }
  }
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
    },
  });
}
