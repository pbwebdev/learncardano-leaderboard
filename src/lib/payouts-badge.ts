/**
 * Helpers for the public "Payouts verified ✓" badge.
 *
 * Pure-logic + a DB-touching wrapper. The pure helper takes per-project
 * batch summaries and returns whether the badge should show; the DB
 * wrapper batches the query for the projects-list page.
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { partnerPayoutBatches } from "@/db/schema";

export interface ProjectBatchSummary {
  total: number;
  verified: number;
}

/**
 * Show the badge when there's at least one batch AND every batch for the
 * project has verified_on_chain=1. Zero batches is NOT a positive trust
 * signal — we hide the badge entirely.
 */
export function shouldShowPayoutsVerifiedBadge(s: ProjectBatchSummary): boolean {
  return s.total > 0 && s.verified === s.total;
}

/**
 * Fetch batch counts per project. Returns a Map keyed by project id with
 * { total, verified }. Used by /projects to decide per-tile badge state.
 */
export async function getBatchSummariesForProjects(
  projectIds: ReadonlyArray<string>,
): Promise<Map<string, ProjectBatchSummary>> {
  const out = new Map<string, ProjectBatchSummary>();
  if (projectIds.length === 0) return out;
  const rows = await getDb()
    .select({
      projectId: partnerPayoutBatches.projectId,
      verifiedOnChain: partnerPayoutBatches.verifiedOnChain,
    })
    .from(partnerPayoutBatches)
    .where(inArray(partnerPayoutBatches.projectId, projectIds as string[]));
  for (const r of rows) {
    const cur = out.get(r.projectId) ?? { total: 0, verified: 0 };
    cur.total += 1;
    if (r.verifiedOnChain) cur.verified += 1;
    out.set(r.projectId, cur);
  }
  return out;
}

export async function getBatchSummaryForProject(projectId: string): Promise<ProjectBatchSummary> {
  const rows = await getDb()
    .select({ verifiedOnChain: partnerPayoutBatches.verifiedOnChain })
    .from(partnerPayoutBatches)
    .where(eq(partnerPayoutBatches.projectId, projectId));
  let total = 0;
  let verified = 0;
  for (const r of rows) {
    total += 1;
    if (r.verifiedOnChain) verified += 1;
  }
  return { total, verified };
}
