-- ────────────────────────────────────────────────────────────────────────────
-- Test seed data for visual design + layout work.
--
-- Adds 3 fictional partner projects, 12 tasks across them, 12 fake users,
-- and ~55 verified submissions + matching points_ledger rows so the
-- leaderboard, /me, /u/[stake], /projects, and project-detail pages all
-- render with meaningful content.
--
-- Idempotent: re-running drops the test submissions + ledger rows first
-- (keyed off the `stake1uxtest…` user prefix and `test-…` project slug
-- prefix), then re-inserts.  Projects / tasks / users use INSERT OR IGNORE
-- so they stay put across runs.
--
-- Apply locally:   wrangler d1 execute DB --file=scripts/seed-test-data.sql
-- Apply remotely:  wrangler d1 execute DB --remote --file=scripts/seed-test-data.sql
--
-- Cleanup:         see scripts/clean-test-data.sql
-- ────────────────────────────────────────────────────────────────────────────

-- ── Clean previous test submissions + ledger before re-insert ──────────────

DELETE FROM points_ledger WHERE user_id LIKE 'stake1uxtest%';
DELETE FROM submissions   WHERE user_id LIKE 'stake1uxtest%';
DELETE FROM tracked_links WHERE project_id LIKE 'test-%';

-- ── Projects ───────────────────────────────────────────────────────────────
-- Three categories so we cover the visual range: defi card, nft card,
-- governance card.

INSERT OR IGNORE INTO projects
  (id, name, description, website_url, referral_url, category, status, display_order, campaign_start_date, partner_notes)
VALUES
  ('test-stellaswap',
   'StellaSwap',
   '# StellaSwap

A fictional DEX used only for visual testing of the leaderboard.  Trade pairs, provide liquidity, earn points.

- ADA / DJED pair
- LP receipts as NFTs
- Order-book settlement on Plutus V2',
   'https://example.com/stellaswap',
   'https://example.com/stellaswap?ref=lcl',
   'defi', 'active', 0, NULL,
   '⚠️ TEST DATA — visual design only.  Not a real partner.'),
  ('test-novanft',
   'NovaNFT',
   '# NovaNFT

Fictional Cardano NFT marketplace used for layout testing.  Mint, list, trade — every interaction is verified on-chain.

- Royalty enforcement
- CIP-25 + CIP-68 metadata
- Built-in offer book',
   'https://example.com/novanft',
   'https://example.com/novanft?ref=lcl',
   'nft', 'active', 1, NULL,
   '⚠️ TEST DATA — visual design only.'),
  ('test-quill',
   'Quill DAO',
   '# Quill DAO

Fictional governance tooling.  Delegate to a DRep, vote on proposals, earn points for active participation.

- DRep delegation tracking
- Governance action voting
- Active-DRep incentives',
   'https://example.com/quill',
   'https://example.com/quill?ref=lcl',
   'governance', 'active', 2, NULL,
   '⚠️ TEST DATA — visual design only.');

-- ── Tasks ──────────────────────────────────────────────────────────────────
-- 4 per project = 12 total.  Mix of types so admin views + project pages
-- exercise the full task-type styling.

INSERT OR IGNORE INTO tasks
  (id, project_id, title, description_md, task_type, task_config, verification_method, points, max_completions_per_user, total_completion_cap, display_order, status)
VALUES
  -- StellaSwap (DEX)
  ('test-task-stella-01', 'test-stellaswap', 'Swap on StellaSwap',
   'Do any ADA → DJED swap of at least 5 ADA. Paste the tx hash.',
   'tx_swap',
   '{"scriptAddresses":["addr1zexamplestellaswapscript000000000000000000000000000000"],"minAdaIn":5000000}',
   'manual', 100, 1, 0, 0, 'active'),
  ('test-task-stella-02', 'test-stellaswap', 'Mint LP receipt',
   'Deposit liquidity. The receipt NFT mint counts.',
   'asset_purchase',
   '{"policyId":"00112233445566778899aabbccddeeff00112233445566778899aabb","minQuantity":1}',
   'manual', 150, 1, 0, 1, 'active'),
  ('test-task-stella-03', 'test-stellaswap', 'Share a swap screenshot',
   'Drop a screenshot of your StellaSwap dashboard. Admin reviews.',
   'manual_review',
   '{"instructions":"Screenshot of your portfolio page including at least one StellaSwap LP position","requiresProofUrl":false,"requiresScreenshot":true}',
   'manual', 50, 1, 0, 2, 'active'),
  ('test-task-stella-04', 'test-stellaswap', 'Tweet about StellaSwap',
   'Post a tweet tagging @stellaswap with #StellaSwap and your favourite pool.',
   'x_tweet',
   '{"requiredHashtags":["StellaSwap"],"requiredMentions":["stellaswap"]}',
   'manual', 30, 1, 0, 3, 'active'),

  -- NovaNFT
  ('test-task-nova-01', 'test-novanft', 'Mint your first NovaNFT',
   'Buy or mint any asset on NovaNFT. The mint tx hash is your proof.',
   'asset_purchase',
   '{"policyId":"aabbccddeeff00112233445566778899aabbccddeeff001122334455","minQuantity":1}',
   'manual', 120, 1, 0, 0, 'active'),
  ('test-task-nova-02', 'test-novanft', 'List an NFT for sale',
   'List anything on NovaNFT. Tx must hit the marketplace script.',
   'tx_swap',
   '{"scriptAddresses":["addr1zexamplenovanftmarketscript00000000000000000000000000"]}',
   'manual', 80, 1, 0, 1, 'active'),
  ('test-task-nova-03', 'test-novanft', 'Manual: review submission',
   'Tell us what you like or hate about the marketplace.',
   'manual_review',
   '{"instructions":"Write 2-3 sentences of feedback about NovaNFT","requiresProofUrl":false,"requiresScreenshot":false}',
   'manual', 40, 1, 0, 2, 'active'),
  ('test-task-nova-04', 'test-novanft', 'Comment on the launch video',
   'Leave a thoughtful YouTube comment on the launch announcement.',
   'youtube_comment',
   '{"videoId":"dQw4w9WgXcQ"}',
   'manual', 25, 1, 0, 3, 'active'),

  -- Quill DAO
  ('test-task-quill-01', 'test-quill', 'Delegate to a Quill-aligned DRep',
   'Pick any Quill-recommended DRep from our list and delegate.',
   'drep_delegation',
   '{"mustBeActive":true}',
   'manual', 200, 1, 0, 0, 'active'),
  ('test-task-quill-02', 'test-quill', 'Register your own DRep',
   'Register as a DRep, even if you only represent yourself.',
   'drep_registered',
   '{}',
   'manual', 250, 1, 0, 1, 'active'),
  ('test-task-quill-03', 'test-quill', 'Vote on a governance action',
   'Cast at least one DRep vote in the current epoch.',
   'governance_vote',
   '{}',
   'manual', 175, 1, 0, 2, 'active'),
  ('test-task-quill-04', 'test-quill', 'Retweet the Quill manifesto',
   'Retweet our pinned post.',
   'x_retweet',
   '{"targetTweetId":"1700000000000000001"}',
   'manual', 20, 1, 0, 3, 'active');

-- ── Users ─────────────────────────────────────────────────────────────────
-- 12 fake users.  Stake addresses follow `stake1uxtestNN…` so cleanup is
-- easy.  All set to onboardingCompleted=1 + profileVisibility='public' so
-- they appear on the leaderboard.  Two users (10 + 11) are private — these
-- should NOT appear, useful for testing the privacy filter visually.

INSERT OR IGNORE INTO users
  (stake_address, payment_address, age_bracket, country, experience_level, referral_source, ref_code, invited_by_ref_code, onboarding_completed, profile_visibility, x_handle)
VALUES
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', NULL, '25-34', 'AU', 'power',    'twitter', 'TST00001', NULL,       1, 'public',  'astroboysoup'),
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', NULL, '35-44', 'JP', 'hodler',   'youtube', 'TST00002', 'TST00001', 1, 'public',  NULL),
  ('stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', NULL, '18-24', 'US', 'newcomer', 'friend',  'TST00003', 'TST00001', 1, 'public',  NULL),
  ('stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04', NULL, '25-34', 'BR', 'hodler',   'twitter', 'TST00004', NULL,       1, 'public',  NULL),
  ('stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', NULL, '45-54', 'DE', 'power',    'other',   'TST00005', NULL,       1, 'public',  NULL),
  ('stake1uxtest06a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh06', NULL, '35-44', 'IN', 'hodler',   'youtube', 'TST00006', 'TST00002', 1, 'public',  NULL),
  ('stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07', NULL, '25-34', 'GB', 'newcomer', 'twitter', 'TST00007', NULL,       1, 'public',  NULL),
  ('stake1uxtest08a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh08', NULL, '18-24', 'NG', 'newcomer', 'friend',  'TST00008', 'TST00004', 1, 'public',  NULL),
  ('stake1uxtest09a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh09', NULL, '55-64', 'CA', 'hodler',   'other',   'TST00009', NULL,       1, 'public',  NULL),
  ('stake1uxtest10a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh10', NULL, '25-34', 'FR', 'power',    'twitter', 'TST00010', NULL,       1, 'private', NULL),
  ('stake1uxtest11a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh11', NULL, '35-44', 'KR', 'hodler',   'twitter', 'TST00011', NULL,       1, 'private', NULL),
  ('stake1uxtest12a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh12', NULL, '65+',   'NZ', 'power',    'friend',  'TST00012', 'TST00005', 1, 'public',  NULL);

-- ── Submissions + ledger ──────────────────────────────────────────────────
-- Spread of verified submissions so different users land at different
-- points totals.  Includes a couple of `pending` and `rejected` rows so
-- /me shows status pills + the leaderboard / admin queue have content.

-- Helper: every verified submission needs a points_ledger row with
-- delta = task.points and reason='task_verified'.  We hardcode the deltas
-- here to keep the SQL transparent (also gives obvious magic numbers if
-- something gets miscounted).

-- ─── user 01 (the power user — high score, all projects engaged) ─────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0101', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-stella-01', 'verified', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0102', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-stella-02', 'verified', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0103', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-stella-03', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0104', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-stella-04', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0105', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-nova-01',   'verified', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa05', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0106', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-nova-02',   'verified', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa06', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0107', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-quill-01',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0108', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-quill-02',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0109', 'stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 'test-task-quill-03',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 100, 'task_verified', 'test-sub-0101', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 150, 'task_verified', 'test-sub-0102', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01',  50, 'task_verified', 'test-sub-0103', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01',  30, 'task_verified', 'test-sub-0104', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 120, 'task_verified', 'test-sub-0105', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01',  80, 'task_verified', 'test-sub-0106', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 200, 'task_verified', 'test-sub-0107', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 250, 'task_verified', 'test-sub-0108', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest01a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh01', 175, 'task_verified', 'test-sub-0109', 'seed', unixepoch('subsec')*1000);
-- user 01 total: 1155 pts

-- ─── user 02 (high-mid score, defi + governance) ─────────────────────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0201', 'stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 'test-task-stella-01', 'verified', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0202', 'stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 'test-task-stella-02', 'verified', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0203', 'stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 'test-task-quill-01',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0204', 'stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 'test-task-quill-03',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0205', 'stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 'test-task-nova-03',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 100, 'task_verified', 'test-sub-0201', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 150, 'task_verified', 'test-sub-0202', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 200, 'task_verified', 'test-sub-0203', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02', 175, 'task_verified', 'test-sub-0204', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest02a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh02',  40, 'task_verified', 'test-sub-0205', 'seed', unixepoch('subsec')*1000);
-- user 02 total: 665 pts

-- ─── user 03 (mid score, defi heavy) ────────────────────────────────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0301', 'stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', 'test-task-stella-01', 'verified', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0302', 'stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', 'test-task-stella-03', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0303', 'stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', 'test-task-stella-04', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0304', 'stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', 'test-task-nova-04',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03', 100, 'task_verified', 'test-sub-0301', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03',  50, 'task_verified', 'test-sub-0302', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03',  30, 'task_verified', 'test-sub-0303', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest03a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh03',  25, 'task_verified', 'test-sub-0304', 'seed', unixepoch('subsec')*1000);
-- user 03 total: 205 pts

-- ─── user 04 (mid score, nft heavy) ─────────────────────────────────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0401', 'stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04', 'test-task-nova-01',   'verified', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0402', 'stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04', 'test-task-nova-02',   'verified', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd02', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0403', 'stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04', 'test-task-nova-03',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04', 120, 'task_verified', 'test-sub-0401', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04',  80, 'task_verified', 'test-sub-0402', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest04a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh04',  40, 'task_verified', 'test-sub-0403', 'seed', unixepoch('subsec')*1000);
-- user 04 total: 240 pts

-- ─── user 05 (governance-focused power user) ────────────────────────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0501', 'stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 'test-task-quill-01',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0502', 'stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 'test-task-quill-02',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0503', 'stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 'test-task-quill-03',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0504', 'stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 'test-task-quill-04',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 200, 'task_verified', 'test-sub-0501', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 250, 'task_verified', 'test-sub-0502', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05', 175, 'task_verified', 'test-sub-0503', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest05a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh05',  20, 'task_verified', 'test-sub-0504', 'seed', unixepoch('subsec')*1000);
-- user 05 total: 645 pts

-- ─── users 06-09 (low-mid varied) ────────────────────────────────────────
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-0601', 'stake1uxtest06a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh06', 'test-task-stella-01', 'verified', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0602', 'stake1uxtest06a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh06', 'test-task-nova-04',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0701', 'stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07', 'test-task-stella-03', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0702', 'stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07', 'test-task-nova-03',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0703', 'stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07', 'test-task-quill-04',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0801', 'stake1uxtest08a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh08', 'test-task-stella-04', 'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0802', 'stake1uxtest08a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh08', 'test-task-nova-04',   'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0901', 'stake1uxtest09a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh09', 'test-task-quill-01',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-0902', 'stake1uxtest09a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh09', 'test-task-quill-03',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest06a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh06', 100, 'task_verified', 'test-sub-0601', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest06a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh06',  25, 'task_verified', 'test-sub-0602', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07',  50, 'task_verified', 'test-sub-0701', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07',  40, 'task_verified', 'test-sub-0702', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest07a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh07',  20, 'task_verified', 'test-sub-0703', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest08a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh08',  30, 'task_verified', 'test-sub-0801', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest08a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh08',  25, 'task_verified', 'test-sub-0802', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest09a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh09', 200, 'task_verified', 'test-sub-0901', 'seed', unixepoch('subsec')*1000),
  ('stake1uxtest09a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh09', 175, 'task_verified', 'test-sub-0902', 'seed', unixepoch('subsec')*1000);
-- user 06: 125, user 07: 110, user 08: 55, user 09: 375

-- ─── users 10 + 11 (private profiles — should NOT appear on leaderboard)
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at)
VALUES
  ('test-sub-1001', 'stake1uxtest10a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh10', 'test-task-stella-01', 'verified', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01', unixepoch('subsec')*1000, unixepoch('subsec')*1000),
  ('test-sub-1101', 'stake1uxtest11a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh11', 'test-task-quill-02',  'verified', NULL, unixepoch('subsec')*1000, unixepoch('subsec')*1000);

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest10a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh10', 100, 'task_verified', 'test-sub-1001', 'seed (private)', unixepoch('subsec')*1000),
  ('stake1uxtest11a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh11', 250, 'task_verified', 'test-sub-1101', 'seed (private)', unixepoch('subsec')*1000);

-- ─── user 12 (one pending + one rejected — exercises the status pills)
INSERT INTO submissions (id, user_id, task_id, status, tx_hash, submitted_at, verified_at, rejection_reason)
VALUES
  ('test-sub-1201', 'stake1uxtest12a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh12', 'test-task-stella-01', 'verified', '000000000000000000000000000000000000000000000000000000000000000c', unixepoch('subsec')*1000, unixepoch('subsec')*1000, NULL),
  ('test-sub-1202', 'stake1uxtest12a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh12', 'test-task-quill-03',  'pending',  NULL, unixepoch('subsec')*1000, NULL, NULL),
  ('test-sub-1203', 'stake1uxtest12a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh12', 'test-task-nova-02',   'rejected', '00000000000000000000000000000000000000000000000000000000000000ff', unixepoch('subsec')*1000, NULL, 'script_hash_not_present');

INSERT INTO points_ledger (user_id, delta, reason, submission_id, note, created_at) VALUES
  ('stake1uxtest12a2b3c4d5e6f7g8h9j0klmnpqrstuvwxyz23456789abcdefgh12', 100, 'task_verified', 'test-sub-1201', 'seed', unixepoch('subsec')*1000);
-- user 12: 100 (one rejected + one pending, no ledger entries for those)

-- ── Expected leaderboard (public users only, descending) ──────────────────
-- 01: 1155 pts · 9 verified · 3 projects
-- 02:  665 pts · 5 verified · 3 projects
-- 05:  645 pts · 4 verified · 1 project
-- 09:  375 pts · 2 verified · 1 project
-- 04:  240 pts · 3 verified · 1 project
-- 03:  205 pts · 4 verified · 2 projects
-- 06:  125 pts · 2 verified · 2 projects
-- 07:  110 pts · 3 verified · 3 projects
-- 12:  100 pts · 1 verified · 1 project
-- 08:   55 pts · 2 verified · 2 projects
-- (users 10 + 11 hidden by profile_visibility='private')
