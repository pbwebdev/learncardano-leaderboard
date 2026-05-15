/**
 * Personal referral link helpers. Phase 3.
 *
 * Each (project, userRefCode) pair maps to one Dub-tracked link mirrored
 * in the `tracked_links` D1 table. Resolution is lazy: first time a
 * signed-in user visits /projects/[slug] we look up an existing
 * tracked_links row, and if absent + Dub is configured + the project
 * has a referralUrl, we create one and persist.
 *
 * Failure to talk to Dub is non-fatal at this layer too — callers fall
 * back to the project's plain shortUrl (or its referralUrl) so the page
 * never crashes.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { trackedLinks } from "@/db/schema";
import { DubNotConfiguredError, createLink, isDubConfigured } from "@/lib/dub";

export interface ResolveResult {
  shortUrl: string | null;
  destinationUrl: string;
  trackedLinkId?: string;
}

export async function resolvePersonalReferralLink(opts: {
  projectId: string;
  projectReferralUrl: string;
  userRefCode: string;
}): Promise<ResolveResult> {
  const db = getDb();
  const existing = (await db
    .select()
    .from(trackedLinks)
    .where(and(eq(trackedLinks.projectId, opts.projectId), eq(trackedLinks.userRefCode, opts.userRefCode)))
    .limit(1))[0];
  if (existing) {
    return { shortUrl: existing.shortUrl, destinationUrl: existing.destinationUrl, trackedLinkId: existing.id };
  }
  if (!isDubConfigured()) {
    return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
  }
  try {
    const link = await createLink({
      url: opts.projectReferralUrl,
      externalId: `${opts.projectId}:${opts.userRefCode}`,
      tags: ["leaderboard", `project:${opts.projectId}`, `ref:${opts.userRefCode}`],
    });
    const id = crypto.randomUUID();
    await db.insert(trackedLinks).values({
      id,
      projectId: opts.projectId,
      taskId: null,
      userRefCode: opts.userRefCode,
      dubLinkId: link.id,
      shortUrl: link.shortLink,
      destinationUrl: opts.projectReferralUrl,
    });
    return { shortUrl: link.shortLink, destinationUrl: opts.projectReferralUrl, trackedLinkId: id };
  } catch (e) {
    if (e instanceof DubNotConfiguredError) {
      return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
    }
    console.warn("[referral-links] dub createLink failed", e instanceof Error ? e.message : e);
    return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
  }
}
