"use server";

import { eq } from "drizzle-orm";
import { getCurrentStakeAddress } from "@/lib/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { logChange } from "@/lib/audit";

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
  const invitedByRefCode = String(formData.get("invitedByRefCode") ?? "") || null;

  // Generate a 6-char refCode from the stake credential — deterministic so
  // re-onboarding doesn't re-roll it.
  const refCode = userId.slice(-6).toLowerCase();

  await getDb().update(users)
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
}
