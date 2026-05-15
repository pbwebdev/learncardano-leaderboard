"use server";

import { eq } from "drizzle-orm";
import { getCurrentStakeAddress } from "@/lib/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { generateRefCode, looksLikeRefCode, normaliseRefCode } from "@/lib/ref-code";

/**
 * Server actions for /me. All start with `getCurrentStakeAddress()` so an
 * unauthenticated caller gets `not_authenticated` (handled by the route
 * handler error envelope; for server actions Next surfaces the throw).
 */

export async function setProfileVisibility(formData: FormData): Promise<void> {
  const userId = await getCurrentStakeAddress();
  const value = String(formData.get("visibility") ?? "");
  if (value !== "public" && value !== "private") return;

  const db = getDb();
  const existing = await db.select({ profileVisibility: users.profileVisibility }).from(users).where(eq(users.stakeAddress, userId)).limit(1);
  const prev = existing[0]?.profileVisibility ?? null;
  if (prev === value) return;

  await db.update(users).set({ profileVisibility: value }).where(eq(users.stakeAddress, userId));
  await logChange({
    userId,
    entityType: "user",
    entityId: userId,
    field: "profile_visibility",
    oldValue: prev,
    newValue: value,
  });
}

/**
 * Onboarding survey submission stub — fields per CLAUDE.md § Data model.
 * Wires fields into the users row, flips `onboardingCompleted=true`.
 */
export async function submitOnboarding(formData: FormData): Promise<void> {
  const userId = await getCurrentStakeAddress();
  const ageBracket = String(formData.get("ageBracket") ?? "") || null;
  const country = String(formData.get("country") ?? "") || null;
  const experienceLevel = String(formData.get("experienceLevel") ?? "") || null;
  const referralSource = String(formData.get("referralSource") ?? "") || null;
  const rawInvited = String(formData.get("invitedByRefCode") ?? "");

  const db = getDb();

  // refCode: keep whatever the auth-verify route set on first sign-in.
  // Backfill only if missing (Phase 0 users predate the column).
  const existing = (await db.select({ refCode: users.refCode }).from(users).where(eq(users.stakeAddress, userId)).limit(1))[0];
  const refCode = existing?.refCode ?? generateRefCode();

  // Validate invitedByRefCode: must be syntactically a refCode AND resolve
  // to a real user that is NOT the submitter (you can't refer yourself).
  let invitedByRefCode: string | null = null;
  if (rawInvited) {
    const normalised = normaliseRefCode(rawInvited);
    if (looksLikeRefCode(normalised)) {
      const inviter = (await db.select({ stakeAddress: users.stakeAddress }).from(users).where(eq(users.refCode, normalised)).limit(1))[0];
      if (inviter && inviter.stakeAddress !== userId) {
        invitedByRefCode = normalised;
      }
    }
  }

  await db.update(users)
    .set({
      ageBracket,
      country,
      experienceLevel,
      referralSource,
      invitedByRefCode,
      refCode,
      onboardingCompleted: true,
    })
    .where(eq(users.stakeAddress, userId));

  await logChange({
    userId,
    entityType: "user",
    entityId: userId,
    field: "onboarding_completed",
    oldValue: false,
    newValue: true,
  });
  if (invitedByRefCode) {
    await logChange({
      userId,
      entityType: "user",
      entityId: userId,
      field: "invited_by_ref_code",
      oldValue: null,
      newValue: invitedByRefCode,
    });
  }
}

/**
 * Disconnect the user's X account. Clears the encrypted tokens AND the
 * public identity fields (xUserId / xHandle) so the verifier flips to
 * `no_x_account` on the next submission. Audit-logged.
 *
 * The tokens-at-rest are encrypted, but we still wipe them on disconnect
 * so that a future DB compromise can't retroactively use an old session.
 */
export async function disconnectX(): Promise<void> {
  const userId = await getCurrentStakeAddress();
  const db = getDb();
  const prev = (await db
    .select({ xHandle: users.xHandle })
    .from(users)
    .where(eq(users.stakeAddress, userId))
    .limit(1))[0];
  if (!prev?.xHandle) return; // already disconnected — no-op
  await db
    .update(users)
    .set({
      xUserId: null,
      xHandle: null,
      xConnectedAt: null,
      xAccessTokenEnc: null,
      xRefreshTokenEnc: null,
      xTokenExpiresAt: null,
    })
    .where(eq(users.stakeAddress, userId));
  await logChange({
    userId,
    entityType: "user",
    entityId: userId,
    field: "x_handle",
    oldValue: prev.xHandle,
    newValue: null,
  });
}

/**
 * Disconnect the user's YouTube channel. Same pattern as disconnectX.
 */
export async function disconnectYoutube(): Promise<void> {
  const userId = await getCurrentStakeAddress();
  const db = getDb();
  const prev = (await db
    .select({ channelId: users.youtubeChannelId, channelTitle: users.youtubeChannelTitle })
    .from(users)
    .where(eq(users.stakeAddress, userId))
    .limit(1))[0];
  if (!prev?.channelId) return;
  await db
    .update(users)
    .set({
      youtubeChannelId: null,
      youtubeChannelTitle: null,
      youtubeConnectedAt: null,
      youtubeAccessTokenEnc: null,
      youtubeRefreshTokenEnc: null,
      youtubeTokenExpiresAt: null,
    })
    .where(eq(users.stakeAddress, userId));
  await logChange({
    userId,
    entityType: "user",
    entityId: userId,
    field: "youtube_channel",
    oldValue: prev.channelTitle ?? prev.channelId,
    newValue: null,
  });
}
