import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Phase 0 schema — users + audit log only. Subsequent phases add projects,
 * tasks, submissions, points_ledger, partner_payout_batches, tracked_links,
 * click_events. See CLAUDE.md § Data model for the full target.
 */

export const users = sqliteTable("users", {
  // Bech32 stake address (stake1...) — canonical user ID across the app.
  stakeAddress: text("stake_address").primaryKey(),
  // Last seen payment address (denormalised — refreshed on each sign-in).
  paymentAddress: text("payment_address"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),

  // Onboarding survey (Phase 0 captures shape; pages land in Phase 1 polish).
  ageBracket: text("age_bracket"), // '<18' | '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+'
  country: text("country"),         // ISO 3166-1 alpha-2 (or alpha-3) — Peter to confirm
  experienceLevel: text("experience_level"), // 'newcomer' | 'hodler' | 'power'
  referralSource: text("referral_source"),   // 'twitter' | 'youtube' | 'friend' | 'other'
  refCode: text("ref_code").unique(),
  invitedByRefCode: text("invited_by_ref_code"),
  onboardingCompleted: integer("onboarding_completed", { mode: "boolean" })
    .notNull()
    .default(false),

  // Social OAuth links — populated in Phase 3.
  xUserId: text("x_user_id"),
  xHandle: text("x_handle"),
  youtubeChannelId: text("youtube_channel_id"),

  // Public profile visibility — 'public' renders /u/[stakeAddress], 'private'
  // returns notFound(). Default 'public' so a freshly-onboarded user appears
  // on the leaderboard immediately; users can toggle on /me.
  profileVisibility: text("profile_visibility").notNull().default("public"),

  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Stake address of the actor (admin or user) who performed the change.
  userId: text("user_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
});
