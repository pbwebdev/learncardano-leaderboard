import type { MetadataRoute } from "next";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { getPointsLeaderboard } from "@/lib/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = "https://leaderboard.learncardano.io";

/**
 * Sitemap enumerates the canonical routes plus every active project and
 * the top 500 public profiles by points. Public profiles only — private
 * users excluded by getPointsLeaderboard's filter. Wrapped in try/catch
 * so a DB blip never 500s the sitemap fetch.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/projects`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];

  let projectEntries: MetadataRoute.Sitemap = [];
  let userEntries: MetadataRoute.Sitemap = [];
  try {
    const db = getDb();
    const activeProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.status, "active"))
      .orderBy(asc(projects.displayOrder));
    projectEntries = activeProjects.map((p) => ({
      url: `${SITE_URL}/projects/${p.id}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

    const topUsers = await getPointsLeaderboard(500);
    userEntries = topUsers.map((u) => ({
      url: `${SITE_URL}/u/${u.stakeAddress}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    }));
  } catch (e) {
    console.warn("[sitemap] db unavailable, returning static routes only", e);
  }

  return [...base, ...projectEntries, ...userEntries];
}
