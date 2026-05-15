import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/**
 * Phase 0 schema landed users + audit_log. Phase 1 extends with:
 *   - projects        partner project metadata
 *   - tasks           per-project tasks (Phase 1 only ships manual_review)
 *   - submissions     user submissions + admin review state
 *   - points_ledger   append-only points history (delta rows; never UPDATE)
 *
 * Later phases will add: partner_payout_batches, tracked_links, click_events.
 * See CLAUDE.md § Data model.
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
  // Tokens stored at-rest as base64url(iv|ciphertext|tag), AES-GCM with a
  // key HKDF-derived from AUTH_SESSION_SECRET (see src/lib/crypto.ts). The
  // app never logs them and only decrypts on the verifier path.
  xUserId: text("x_user_id"),
  xHandle: text("x_handle"),
  xConnectedAt: integer("x_connected_at", { mode: "timestamp_ms" }),
  xAccessTokenEnc: text("x_access_token_enc"),
  xRefreshTokenEnc: text("x_refresh_token_enc"),
  xTokenExpiresAt: integer("x_token_expires_at", { mode: "timestamp_ms" }),

  youtubeChannelId: text("youtube_channel_id"),
  youtubeChannelTitle: text("youtube_channel_title"),
  youtubeConnectedAt: integer("youtube_connected_at", { mode: "timestamp_ms" }),
  youtubeAccessTokenEnc: text("youtube_access_token_enc"),
  youtubeRefreshTokenEnc: text("youtube_refresh_token_enc"),
  youtubeTokenExpiresAt: integer("youtube_token_expires_at", { mode: "timestamp_ms" }),

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

/**
 * Partner projects. `id` is the human-readable slug used in URLs (e.g.
 * `/projects/minswap`). Slug edits are blocked once any submission exists
 * for a task under this project — application-level guard in the admin
 * action.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // slug
  name: text("name").notNull(),
  logoR2Key: text("logo_r2_key"),
  description: text("description").notNull().default(""), // markdown
  websiteUrl: text("website_url"),
  referralUrl: text("referral_url"),
  // Opaque external short-link id from whichever provider we're on.
  // Column name retained for historical reasons (Dub.co → Short.io swap);
  // renaming would require a destructive migration. Do not rename.
  dubLinkId: text("dub_link_id"),     // populated in Phase 3
  shortUrl: text("short_url"),        // populated in Phase 3
  category: text("category").notNull().default("infra"), // 'defi' | 'nft' | 'governance' | 'infra' | 'education' | 'gaming'
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'upcoming' | 'ended'
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  // Anything before this is ineligible for on-chain tasks (Phase 2+).
  campaignStartDate: integer("campaign_start_date", { mode: "timestamp_ms" }),
});

/**
 * Tasks per project. `taskType` is a discriminator the verifier dispatcher
 * reads; Phase 1 only enables `manual_review`. The admin UI shows all 10
 * types in a dropdown but disables the non-manual ones (greyed Phase 2).
 *
 * `taskConfig` is task-type-specific JSON. For manual_review:
 *   { instructions: string, requiresProofUrl?: boolean, requiresScreenshot?: boolean }
 */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), // uuid
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  descriptionMd: text("description_md").notNull().default(""),
  taskType: text("task_type").notNull(), // 'manual_review' | 'pool_delegation' | ...
  taskConfig: text("task_config", { mode: "json" }).$type<unknown>(),
  verificationMethod: text("verification_method").notNull().default("manual"),
  // 'auto_onchain' | 'auto_oauth' | 'auto_webhook' | 'manual'
  points: integer("points").notNull().default(0),
  tokenReward: text("token_reward", { mode: "json" }).$type<unknown>(),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }),
  // usually 1; 0 means "unlimited" but Phase 1 default is 1.
  maxCompletionsPerUser: integer("max_completions_per_user").notNull().default(1),
  totalCompletionCap: integer("total_completion_cap").notNull().default(0), // 0 = no cap
  displayOrder: integer("display_order").notNull().default(0),
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'paused' | 'ended'
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (t) => ({
  byProject: index("tasks_project_idx").on(t.projectId),
  byStatus: index("tasks_status_idx").on(t.status),
}));

/**
 * Submissions. `(userId, taskId, txHash)` is UNIQUE — same tx can't be
 * claimed for the same task twice. txHash is nullable in Phase 1 (manual
 * review). SQLite's UNIQUE treats NULLs as distinct, so multiple manual
 * submissions for the same (user, task) are allowed at the index level;
 * the application-level check for `maxCompletionsPerUser` enforces the
 * single-completion rule for manual_review tasks. Documented in
 * docs/admin-runbook.md.
 */
export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(), // uuid (crypto.randomUUID)
  userId: text("user_id")
    .notNull()
    .references(() => users.stakeAddress),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  status: text("status").notNull().default("pending"),
  // 'pending' | 'verifying' | 'verified' | 'rejected' | 'paid' | 'reward_verified'
  txHash: text("tx_hash"),
  proofR2Key: text("proof_r2_key"),
  proofUrl: text("proof_url"),
  oauthPayload: text("oauth_payload", { mode: "json" }).$type<unknown>(),
  rejectionReason: text("rejection_reason"),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
  payoutBatchId: text("payout_batch_id"), // FK populated in Phase 4
  notes: text("notes"),                   // admin-only
}, (t) => ({
  uniqClaim: uniqueIndex("submissions_user_task_tx_unique").on(t.userId, t.taskId, t.txHash),
  byTask: index("submissions_task_idx").on(t.taskId),
  byUser: index("submissions_user_idx").on(t.userId),
  byStatus: index("submissions_status_idx").on(t.status),
}));

/**
 * Append-only points ledger. NEVER UPDATE rows. Corrections are new rows
 * with negative deltas (`reason='clawback'` or `'admin_adjust'`).
 */
export const pointsLedger = sqliteTable("points_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.stakeAddress),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(), // 'task_verified' | 'referral_bonus' | 'admin_adjust' | 'clawback'
  submissionId: text("submission_id"), // nullable FK to submissions.id
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (t) => ({
  byUser: index("points_ledger_user_idx").on(t.userId),
  bySubmission: index("points_ledger_submission_idx").on(t.submissionId),
}));

/**
 * Partner payout batches (Phase 4). Created when an admin "Exports winners"
 * for a project: rows are written to a CSV in R2 (csvR2Key), and selected
 * submissions are linked here via submissions.payoutBatchId.
 *
 * State machine:
 *   - Created via /admin/payouts/new        → submissions move 'verified' → 'paid_pending'
 *   - txHash recorded by admin              → submissions move 'paid_pending' → 'paid'
 *   - On-chain verified by daily cron       → verifiedOnChain=1; submissions → 'reward_verified'
 *
 * txHash is unique-when-not-null: same payout tx cannot be recorded twice.
 * SQLite UNIQUE treats NULLs as distinct so multiple pending batches are
 * fine while txHash is null.
 */
export const partnerPayoutBatches = sqliteTable("partner_payout_batches", {
  id: text("id").primaryKey(), // uuid
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  csvR2Key: text("csv_r2_key").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  txHash: text("tx_hash"),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
  verifiedOnChain: integer("verified_on_chain", { mode: "boolean" })
    .notNull()
    .default(false),
  // Discrepancy report when cron detects a mismatch between CSV and tx outputs.
  // Null = no check yet, or check passed.
  discrepancyNote: text("discrepancy_note"),
  recordedByUserId: text("recorded_by_user_id").references(() => users.stakeAddress),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (t) => ({
  uniqTx: uniqueIndex("partner_payout_batches_tx_hash_unique").on(t.txHash),
  byProject: index("partner_payout_batches_project_idx").on(t.projectId),
}));

/**
 * Tracked links (Phase 3). Either a project-level link or a per-user
 * referral link. Created via the Short.io API client and mirrored here
 * so we can resolve click webhooks back to a user and surface click
 * counts on /me and /projects/[slug] without re-calling Short.io.
 *
 *   - projectId+userRefCode null → unused
 *   - projectId set, userRefCode null → the project's main referral link
 *   - projectId set, userRefCode set → personalised referral link
 *
 * `dubLinkId` is UNIQUE so webhook deliveries land on exactly one row.
 * Despite the name it now holds the Short.io link id (opaque external
 * id from whichever provider we're currently on — see actions.ts /
 * short-io.ts). Don't rename without a migration.
 */
export const trackedLinks = sqliteTable("tracked_links", {
  id: text("id").primaryKey(), // uuid
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  taskId: text("task_id"), // nullable — most links are project-level
  userRefCode: text("user_ref_code"), // nullable — resolved against users.refCode
  dubLinkId: text("dub_link_id").notNull(),
  shortUrl: text("short_url").notNull(),
  destinationUrl: text("destination_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (t) => ({
  byDubLink: uniqueIndex("tracked_links_dub_link_unique").on(t.dubLinkId),
  byProject: index("tracked_links_project_idx").on(t.projectId),
  byRefCode: index("tracked_links_ref_code_idx").on(t.userRefCode),
}));

/**
 * Click events (Phase 3) ingested from Short.io webhooks. Append-only.
 * The webhook handler dedupes via `(tracked_link_id, dub_event_id)`
 * UNIQUE because Short.io (like Dub before it) retries on non-2xx.
 *
 * The `dub_*` column names are historical — they hold the Short.io
 * event id now. See short-io.ts and webhooks/short-io/route.ts.
 */
export const clickEvents = sqliteTable("click_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trackedLinkId: text("tracked_link_id")
    .notNull()
    .references(() => trackedLinks.id),
  // Stable per-delivery ID from the short-link provider. Used for
  // idempotency — provider retries on transient failures. Column name
  // retained from the Dub.co → Short.io swap; do not rename.
  dubEventId: text("dub_event_id"),
  // Resolved from trackedLinks.userRefCode if present, else null.
  userId: text("user_id"),
  country: text("country"),
  referrer: text("referrer"),
  userAgent: text("user_agent"),
  ts: integer("ts", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (t) => ({
  byLink: index("click_events_link_idx").on(t.trackedLinkId),
  byUser: index("click_events_user_idx").on(t.userId),
  // Provider event IDs are globally unique; constrain per-link as a
  // belt-and-braces against cross-link collisions.
  uniqEvent: uniqueIndex("click_events_link_event_unique").on(t.trackedLinkId, t.dubEventId),
}));
