/**
 * Personal referral link helpers. Phase 3.
 *
 * Each (project, userRefCode) pair maps to one Short.io-tracked link
 * mirrored in the `tracked_links` D1 table. Resolution is lazy: first
 * time a signed-in user visits /projects/[slug] we look up an existing
 * tracked_links row, and if absent + Short.io is configured + the
 * project has a referralUrl, we create one and persist.
 *
 * Note: column names retain the historical `dub*` spelling. They're
 * treated as opaque "external link id from whichever short-link provider
 * we're currently on". Don't rename without a migration. See schema.ts.
 *
 * Failure to talk to Short.io is non-fatal at this layer too — callers
 * fall back to the project's plain shortUrl (or its referralUrl) so the
 * page never crashes.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { trackedLinks } from "@/db/schema";
import { ShortIoNotConfiguredError, createShortLink, isShortIoConfigured } from "@/lib/short-io";

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
  if (!isShortIoConfigured()) {
    return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
  }
  try {
    const link = await createShortLink({
      originalURL: opts.projectReferralUrl,
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
      shortUrl: link.shortURL,
      destinationUrl: opts.projectReferralUrl,
    });
    return { shortUrl: link.shortURL, destinationUrl: opts.projectReferralUrl, trackedLinkId: id };
  } catch (e) {
    if (e instanceof ShortIoNotConfiguredError) {
      return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
    }
    console.warn("[referral-links] short-io createShortLink failed", e instanceof Error ? e.message : e);
    return { shortUrl: null, destinationUrl: opts.projectReferralUrl };
  }
}
