# Admin runbook

How Peter operates the leaderboard day-to-day. Also the source-of-truth for which admin features actually need to exist — if it isn't here, it probably doesn't need to be built.

## Access

- Admin gate = stake-address allow-list (`ADMIN_STAKE_ADDRESSES` Worker secret, comma-separated).
- Every admin route handler and server action starts with `const adminId = await requireAdmin();`. No exceptions.
- Every admin write is logged to `auditLog` with `userId=adminId`, `entityType`, `entityId`, `field`, `oldValue`, `newValue`.

## Daily loop

### 1. Submissions review queue — `/admin/submissions`
- Filters: project, task, status (`pending` / `needs_review` / `rejected`).
- For each pending submission: render proof URL, screenshot thumbnail (R2 signed URL, 5 min TTL), tx-hash link to cardanoscan.io if present, OAuth payload snapshot, full prior submission history for that user.
- Actions: **Approve** (→ `verified`, append `pointsLedger`), **Reject** (require `rejectionReason`), **Request re-verify** (→ enqueue), **Add note** (admin-only `notes` column).
- Batch operations: bulk-approve / bulk-reject filtered list. Confirmation modal required.

### 2. Projects CRUD — `/admin/projects`
- Add a project: slug, name, logo upload (→ R2), description (markdown), website URL, referral URL, category, campaign start date.
- On save, **auto-create Dub link** for the referral URL → store `dubLinkId`, `shortUrl`. If Dub call fails, surface error and don't persist.
- Edit a project: any field. Slug changes blocked once `submissions.exists` for any of its tasks.
- Status: `draft` (admin-only visibility) → `active` (public) → `upcoming` (public, no submissions accepted) → `ended` (public, archived).

### 3. Tasks CRUD — `/admin/tasks`
- Same shape. Live-validate `taskConfig` against the verifier's Zod schema as you type.
- Preview "what the user sees" panel.
- Bulk-clone task from one project to another (e.g. "delegate to our pool" reused across multiple campaigns).

### 4. Payouts — `/admin/payouts`
- **Export winners**: pick project + date range → CSV to R2, `partnerPayoutBatches` row created, selected submissions move to `paid_pending`.
  - Columns: `payment_address, stake_address, total_reward, asset, submission_ids, completed_at`.
  - Also available as a script: `scripts/export-payout-csv.ts`.
- **Record tx hash**: `/admin/payouts/[batchId]/record` — paste tx hash, sets `txHash`, `paidAt`, `recordedByUserId`. Submissions move to `paid`. Cron handler verifies on-chain within an hour.
- **Discrepancy view**: shows any `paid` batch with `verifiedOnChain=false` after 24h, with the cron handler's reason (underpay, wrong asset, recipient mismatch).

### 5. Audit log — `/admin/audit`
- Paginated, filter by entity type, entity ID, admin user.
- Read-only.

## Operational tasks (not the everyday loop)

### Adding a new admin
- `wrangler secret put ADMIN_STAKE_ADDRESSES` with the comma-separated list including the new stake address.
- Re-deploy not required for secret reads (they're live-read by the Worker).

### Adding a new partner project
1. Peter or a partner contact creates project as `draft`.
2. Logo + final description reviewed.
3. Status → `active`, share project URL with partner.
4. If reward is a partner token, seed the `tokenReward` JSON on each task with `{ policyId, assetName, quantity }`.

#### Partner discovery checklist (for `tx_swap` strict verification)

For high-reward on-chain tasks, ask the partner upfront so the verifier can
pin to the exact contract interaction (see
[`task-types.md` § Strict verification](../docs/task-types.md#strict-verification-optional-recommended-for-high-reward-tasks)):

- Plutus script hash(es) of the contract (56 hex chars).
- Redeemer tag/purpose for the action (`spend` / `mint` / `cert` / `reward`).
- Redeemer constructor index for the rewarded action (e.g. `0` = place order, `1` = cancel).
- Mint policy ID + asset name (if the action mints a receipt / LP token).
- Reference script hash (if the contract uses a reference UTxO).
- Output datum hash (only if the task pins to one datum shape).

Leave any unanswered field blank — the verifier falls back to the baseline
checks (tx exists + confirmed + involves user's wallet + has output to one
of the configured script addresses).

### Recording a Bounty platform completion
- Webhook fires automatically. No admin action needed.
- If a partner reports a missed bounty, manual fallback: admin creates a submission with `status='verified'` and `notes='manual_bounty_record:<reason>'`. Logged.

### Investigating "where are my points"
1. `/admin/users/[stakeAddress]` shows full submission history + ledger.
2. If a submission is `pending` for > 24h, check `/admin/submissions/[id]` for queue retry status.
3. Manual re-trigger: `/api/verify/[id]` POST (admin-only).

### Rotating a secret
1. `wrangler secret put <NAME>` with the new value.
2. Update `.env.local` for build-time secrets (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is the only one in this category).
3. Re-deploy.

### Backups
- Cloudflare D1 has point-in-time restore. No manual backup loop required at launch scale.
- R2 retention: indefinite. Proofs + share cards + payout CSVs stay forever.

## Things this runbook is deliberately silent on

- **Mass user emails**: there's no email system. Don't add one without permission.
- **Manual points adjustments outside the ledger**: never UPDATE `pointsLedger`; always INSERT a corrective delta with `reason='admin_adjust'`.
- **Suspending a user**: not a v1 feature. If absolutely required, add a `users.suspendedAt` column and gate submission POST on it — but file an issue first and check with Peter.
