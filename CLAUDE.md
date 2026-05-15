# Cardano Campaign Leaderboard

A wallet-gated dashboard where users complete on-chain and off-chain tasks across partnered Cardano projects to earn points, climb a public leaderboard, and unlock token rewards. Host: Peter Bui (Learn Cardano / DRep / Cardano Ambassador).

**Author identity for commits:** `Pete <peter@learncardano.io>`
**Sibling project to reuse from:** `cardano-drep-dashboard` (private, already deployed at https://cardano-drep-dashboard.learncardano.io)

This file is the contract between Peter and Claude Code. Read it before doing anything else in this repo. The patterns below are deliberate — they come from a sibling production app and have already been debugged. Do not improvise.

---

## Critical reads BEFORE you write any code

1. This file, top to bottom.
2. `AGENTS.md` — Next.js 16 has breaking changes from older versions you may know. Read `node_modules/next/dist/docs/` for any Next API you're about to use.
3. `docs/lifted-from-drep-dashboard.md` — list of files ported from the sibling repo, with what changed in each. If you're rewriting one of those files from scratch you're doing it wrong.
4. `docs/brief.md` — product brief.
5. The Cardano façade in `src/lib/cardano/index.ts` before calling any chain-data API directly.

---

## The "this isn't your training data" warnings

These have bitten the sibling project and will bite you. Internalise them.

### Next.js 16 + App Router + RSC
- This is **Next.js 16**, App Router, React Server Components. APIs and file conventions differ from older Next. Read `node_modules/next/dist/docs/` before you cite a pattern from memory.
- Heed deprecation notices in `next build` output.
- `cookies()` from `next/headers` is async. `await cookies()` always. Only call it from server components, route handlers, or server actions — not client components or library code that might be called from both.

### OpenNext Cloudflare adapter
- The app deploys as a single Cloudflare Worker via `@opennextjs/cloudflare`. **Not Vercel, not Node, not Edge runtime in the generic Next sense.**
- Bindings (D1, KV, R2, Queues) come from `getCloudflareContext().env`, not `process.env`. For env *vars* and *secrets* (Wrangler `vars` and `wrangler secret put`), also `getCloudflareContext().env.MY_VAR`.
- `revalidatePath()` is **unreliable** under OpenNext + Cloudflare for re-fetching RSC payload. Don't trust it for any save-then-redisplay flow. Use the full-reload-after-save pattern (below).
- `runtime = "nodejs"` and `dynamic = "force-dynamic"` on every route handler that touches bindings, KV, or D1. Don't omit either.

### Server actions need a stable encryption key
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be set as a **build-time env** (in `.env.local`, gitignored) AND as a Worker secret via `wrangler secret put`. Without this, action IDs regenerate per build and any browser tab open across a deploy gets a broken POST.
- This is non-optional. Set it before the first deploy.

### Save flow does a full reload
Pattern lifted from the sibling repo. `src/components/save-form.tsx` (port verbatim when first server action is added):
1. Stash `window.scrollY` in `sessionStorage`.
2. Fade-out animation.
3. `window.location.reload()` after server action resolves.
4. On mount in the new page, read sessionStorage and restore scroll.
This is uglier than `revalidatePath` would be, but it actually works on OpenNext.

### Git footer reflects the build, not HEAD
- The footer shows `process.env.NEXT_PUBLIC_BUILD_HASH` from `git rev-parse --short HEAD` at build time.
- **Always `git commit` before `npx opennextjs-cloudflare build`** if you want the new hash to land in the UI.
- The one-shot deploy chain (below) does this in the right order.

### CIP-30 wallets touch `window` at import time
- Components using `@cardano-foundation/cardano-connect-with-wallet` must be **dynamic-imported with `ssr: false`**.
- See `src/components/wallet-button-client.tsx` and `wallet-gate.tsx` for the pattern. Use them, don't re-derive.

---

## Tech stack — locked in, don't substitute

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC) | Already running on the DRep Dashboard — patterns transfer |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Already deployed on this stack |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM | Free tier comfortable for launch scale; sibling project uses identically |
| KV | Cloudflare KV | Nonces, sessions, cached chain lookups, leaderboard snapshots |
| Object storage | Cloudflare R2 | Proof screenshots, share-card PNGs |
| Async jobs | Cloudflare Queues | New for this project — sibling didn't need them |
| Scheduled jobs | Cloudflare Cron Triggers | Re-check delegations, refresh leaderboard cache |
| Wallet | CIP-30 via `@cardano-foundation/cardano-connect-with-wallet` | Standard, lifted from sibling |
| Signature verification | `@cardano-foundation/cardano-verify-datasignature` (CIP-8 / COSE_Sign1) | Works on Workers — sibling proves it |
| Cardano data — primary | Koios (free, decentralised) | Peter's stated preference; covers most cases |
| Cardano data — fallback | Blockfrost mainnet | Peter has a key; fall back when Koios fails or doesn't cover an endpoint |
| Click tracking | Dub.co API | Better than Bitly for analytics + custom domain support |
| Social verification | X API v2 (OAuth 2.0), YouTube Data API v3 (Google OAuth) | Standard partner APIs |
| Tests | Vitest, node environment | Pure-logic only; same as sibling |
| Styling | Tailwind 4 + CSS variables on `:root` | Same as sibling — see `src/app/globals.css` pattern |

Do not substitute Astro, SvelteKit, Postgres, Supabase, Prisma, Bitly, or any other tool without explicit permission. Peter has chosen this stack deliberately.

---

## Repo layout (target)

```
campaign-leaderboard/
├── CLAUDE.md                       # this file
├── AGENTS.md                       # Next.js warning header (verbatim from sibling)
├── README.md                       # human-facing readme
├── docs/
│   ├── brief.md                    # product brief
│   ├── lifted-from-drep-dashboard.md   # file-by-file port log
│   ├── task-types.md               # spec for every task verification method
│   └── admin-runbook.md            # how Peter operates the admin panel
├── drizzle/migrations/             # SQL migrations + meta/_journal.json
├── drizzle.config.ts
├── open-next.config.ts
├── next.config.ts                  # includes gitShortHash() build env
├── wrangler.jsonc                  # D1, KV, R2, Queues, Cron bindings
├── vitest.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── eslint.config.mjs
├── package.json
├── public/
├── schemas/                        # JSON schemas for inbound webhooks (Bounty platform, Dub)
├── scripts/
│   ├── seed-projects.ts            # idempotent seed for partner projects
│   └── export-payout-csv.ts        # CLI variant of admin export
└── src/
    ├── app/
    │   ├── layout.tsx              # global header, footer with build hash
    │   ├── globals.css             # CSS vars on :root (WCAG AA tracked in comments)
    │   ├── page.tsx                # landing — locked teaser before signin
    │   ├── leaderboard/page.tsx    # public-but-gated leaderboard
    │   ├── projects/
    │   │   ├── page.tsx            # gallery
    │   │   └── [slug]/page.tsx     # detail + tasks
    │   ├── me/
    │   │   ├── page.tsx            # user dashboard
    │   │   ├── onboarding/page.tsx # first-time survey
    │   │   └── actions.ts          # server actions
    │   ├── admin/
    │   │   ├── page.tsx            # admin home (stake-address allow-list gated)
    │   │   ├── projects/           # CRUD
    │   │   ├── tasks/              # CRUD
    │   │   ├── submissions/        # review queue
    │   │   └── payouts/            # export CSV, record tx hash
    │   └── api/
    │       ├── auth/{nonce,verify,signout}/route.ts   # PORTED from sibling
    │       ├── submissions/[id]/route.ts              # status polling
    │       ├── verify/[id]/route.ts                   # manual re-verify trigger
    │       ├── webhooks/
    │       │   ├── dub/route.ts                       # click events
    │       │   └── bounty/route.ts                    # Learn Cardano Bounty completions
    │       └── oauth/
    │           ├── x/{start,callback}/route.ts
    │           └── youtube/{start,callback}/route.ts
    ├── components/
    │   ├── wallet-button.tsx + wallet-button-client.tsx   # PORTED, CIP-95 removed
    │   ├── wallet-gate.tsx + wallet-gate-inner.tsx         # PORTED verbatim
    │   ├── save-form.tsx                                   # PORTED verbatim (full-reload pattern)
    │   ├── local-time.tsx                                  # PORTED verbatim
    │   ├── leaderboard-table.tsx
    │   ├── project-tile.tsx
    │   ├── task-card.tsx
    │   ├── submission-form.tsx                             # tx hash, screenshot, OAuth dispatch
    │   └── share-card.tsx                                  # SVG → PNG share asset
    ├── lib/
    │   ├── session.ts              # PORTED verbatim, rename DRep→Stake
    │   ├── auth.ts                 # PORTED, renamed for stake address
    │   ├── audit.ts                # PORTED verbatim, rename drepId→userId
    │   ├── stake-address.ts        # bech32 helpers — subset of drep-id.ts from sibling
    │   ├── cardano/
    │   │   ├── index.ts            # façade: Koios first, Blockfrost fallback
    │   │   ├── koios.ts            # PORTED + extended (getAccountInfo, getTxInfo, etc.)
    │   │   ├── blockfrost.ts       # mirror Koios surface
    │   │   └── types.ts            # AccountInfo, DRepInfo, TxInfo — provider-agnostic
    │   ├── verification/
    │   │   ├── index.ts            # dispatcher — routes submissions to the right verifier
    │   │   ├── delegation.ts       # pool + DRep delegation tasks
    │   │   ├── drep-activity.ts    # DRep registration + activity tasks
    │   │   ├── tx-hash.ts          # generic on-chain tx verification (swaps, NFT buys)
    │   │   ├── governance.ts       # vote-on-action tasks
    │   │   ├── social-x.ts         # tweet/retweet verification via X API
    │   │   ├── social-youtube.ts   # YouTube comment verification
    │   │   └── manual.ts           # for queue-for-review tasks
    │   ├── dub.ts                  # Dub.co API client
    │   ├── leaderboard.ts          # KV-cached top-N query
    │   ├── points.ts               # append-only ledger helpers
    │   └── admin.ts                # admin allow-list check
    ├── db/
    │   ├── client.ts               # PORTED verbatim
    │   └── schema.ts               # NEW — see "Data model" below
    └── queues/
        ├── verify-consumer.ts      # processes verification jobs
        └── cron-handler.ts         # delegation re-checks, leaderboard refresh
```

Anything in **CAPS PORTED** above means: open the sibling repo's file, adapt to the rename rules in the next section, do not rewrite the logic.

---

## What ports from the DRep Dashboard

### Verbatim (zero logic changes)
- `src/lib/session.ts` — except change `SESSION_COOKIE = "drep_session"` → `"leaderboard_session"`, and the type `SessionPayload = { drep_id }` → `{ stake_address }`. Function names: `signSession(stakeAddress)`, `verifySession()` returns `{ stake_address, iat, exp }`.
- `src/lib/audit.ts` — rename param `drepId` → `userId` (where `userId` is the stake address). Same DB shape.
- `src/db/client.ts` — verbatim.
- `src/components/wallet-gate.tsx` + `wallet-gate-inner.tsx` — verbatim. The fallback copy will say "Connect your wallet from the header to view the leaderboard" instead of the DRep wording.
- `src/components/local-time.tsx` — verbatim.
- `src/components/save-form.tsx` — verbatim once we add the first server action.
- `next.config.ts` — verbatim (includes the `gitShortHash()` build env trick).
- `open-next.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json` — verbatim.
- `.gitignore` — verbatim (especially the `.open-next/`, `.wrangler/`, `.dev.vars`, `cloudflare-env.d.ts`, `.env*` lines).
- `AGENTS.md` — verbatim.

### With minimal renames
- `src/lib/auth.ts` — rename `getCurrentDRepIdOrNull` → `getCurrentStakeAddressOrNull`, `getCurrentDRepId` → `getCurrentStakeAddress`. Drop the `OWNER_DREP_ID` env fallback; replace with `OWNER_STAKE_ADDRESS` (for local dev only; `ALLOW_ENV_AUTH=false` in production, same as sibling).
- `src/app/api/auth/nonce/route.ts` — change the message template:
  ```
  Sign in to Cardano Campaign Leaderboard
  Nonce: <nonce>
  Issued: <iso8601>
  ```
  No `DRep:` line. Keep 24-byte hex nonce, 5min KV TTL.
- `src/app/api/auth/verify/route.ts` — bigger diff:
  - Body type: drop `drep_id` field. The identity is `stake_address_bech32` (already in the original body).
  - Drop the `drepIdFromRewardAddress(stake_address_hex)` derivation and the bech32 `drep1` regex check.
  - Replace with a bech32 sanity check on `stake_address_bech32`: `/^stake1[0-9a-z]+$/`.
  - **Keep the defensive fallback verbatim**: first call `verifyDataSignature(signature, key, message, stake_address_bech32)`; if false, retry with `verifyDataSignature(signature, key)` (crypto-only) — if THAT passes, accept. The lib's strict message/address comparison is encoding-sensitive across wallets; this two-step pattern is what makes it work in production. Don't remove it.
  - On success, `await signSession(stake_address_bech32)`.
- `src/app/api/auth/signout/route.ts` — verbatim, no changes.
- `src/components/wallet-button.tsx`:
  - **Drop** the entire CIP-95 / `getPubDRepKey()` block (where the original derives a DRep ID).
  - **Drop** the `extensions: [{ cip: 95 }]` parameter from `wallet.enable()`.
  - The signed message becomes just the template from `/api/auth/nonce` — no `\nDRep: drep1…` appended.
  - In the POST body to `/api/auth/verify`, drop `drep_id` field.
  - Signed-in chip shows `enabledWallet: stake1xxx…yyy` (it already does).

### Extended (port the file, add new endpoints)
- `src/lib/koios.ts` → becomes `src/lib/cardano/koios.ts`:
  - Keep `koiosPost()`, `cached()`, `formatAda()`, `getDRepInfo()`, `getDRepMetadata()`, `getDRepProfile()` — they're useful for DRep tasks AND for showing a "this user is a DRep" enrichment on profiles.
  - Add new endpoints (Koios POST `/account_info`, `/account_assets`, `/account_history`, `/tx_info`, `/tx_status`, `/pool_info`, `/voter_proposal_list`). Each follows the same `koiosPost` + `cached` pattern. TTLs: account_info 5min, tx_info indefinite (immutable once confirmed — but cache only after `num_confirmations > 0`), pool_info 1hr, drep_info already 10min.

### Patterns to mirror, not file-for-file
- The coverage-cap state machine in `src/lib/scoring.ts` (sibling) — used to gate the "Green" band until 80% of criteria are answered. We mirror this pattern for **payout-readiness gating**: a user's points only become payout-eligible once their submission has been verified AND the partner batch has been recorded AND on-chain verification of the partner's payout tx has succeeded. See `src/lib/points.ts` for our equivalent state machine.
- The audit log pattern — every admin action on a submission, every points adjustment, every project edit gets logged via `logChange()` from `src/lib/audit.ts`. Same shape as sibling.

---

## Data model

D1 schema, defined in `src/db/schema.ts` via Drizzle. Generate migrations with `npx drizzle-kit generate --name=<short_name>` after editing.

### Global tables

```ts
users {
  stakeAddress: text PK              // bech32 stake1... — canonical user ID
  paymentAddress: text                // last seen payment address (denormalised)
  createdAt: timestamp_ms
  // onboarding survey
  ageBracket: text                    // '<18' | '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+'
  country: text                       // ISO-3166-2
  experienceLevel: text               // 'newcomer' | 'hodler' | 'power'
  referralSource: text                // 'twitter' | 'youtube' | 'friend' | 'other'
  refCode: text UNIQUE                // their own shareable code
  invitedByRefCode: text              // FK to users.refCode (nullable)
  onboardingCompleted: boolean default false
  xUserId: text                       // populated after X OAuth
  xHandle: text
  youtubeChannelId: text              // populated after Google OAuth
  isAdmin: boolean default false
}

projects {
  id: text PK                         // slug, e.g. "minswap"
  name: text
  logoR2Key: text                     // R2 key for logo
  description: text                   // markdown
  websiteUrl: text                    // raw destination
  referralUrl: text                   // raw destination (may equal websiteUrl)
  dubLinkId: text                     // Dub.co link ID after creation
  shortUrl: text                      // populated by Dub
  category: text                      // 'defi' | 'nft' | 'governance' | 'infra' | 'education' | 'gaming'
  status: text                        // 'draft' | 'active' | 'upcoming' | 'ended'
  displayOrder: integer
  createdAt: timestamp_ms
  campaignStartDate: timestamp_ms     // anything before this is ineligible for on-chain tasks
}

tasks {
  id: text PK
  projectId: text FK projects.id
  title: text
  descriptionMd: text
  taskType: text                      // see "Task types" below
  taskConfig: text mode:json          // task-type-specific config (target pool, target DRep, hashtags, etc.)
  verificationMethod: text            // 'auto_onchain' | 'auto_oauth' | 'auto_webhook' | 'manual'
  points: integer
  tokenReward: text mode:json         // { policyId, assetName, quantity } | null
  startsAt: timestamp_ms
  endsAt: timestamp_ms                // null = open-ended
  maxCompletionsPerUser: integer      // usually 1
  totalCompletionCap: integer         // 0 = no cap
  displayOrder: integer
  status: text                        // 'draft' | 'active' | 'paused' | 'ended'
}
```

### Per-user tables

```ts
submissions {
  id: text PK                         // uuid
  userId: text FK users.stakeAddress
  taskId: text FK tasks.id
  status: text                        // 'pending' | 'verifying' | 'verified' | 'rejected' | 'paid' | 'reward_verified'
  txHash: text                        // for on-chain tasks
  proofR2Key: text                    // R2 key for screenshot
  proofUrl: text                      // for "share a tweet" style tasks
  oauthPayload: text mode:json        // verifier-specific snapshot (e.g. {tweet_id, posted_at})
  rejectionReason: text
  submittedAt: timestamp_ms
  verifiedAt: timestamp_ms
  payoutBatchId: text FK partnerPayoutBatches.id  // null until exported
  notes: text                         // admin-only
  uniqueIdx: (userId, taskId, txHash)  // prevents claiming same tx for same task twice
}

pointsLedger {                        // append-only
  id: integer PK autoinc
  userId: text FK users.stakeAddress
  delta: integer                      // can be negative for clawbacks
  reason: text                        // 'task_verified' | 'referral_bonus' | 'admin_adjust' | 'clawback'
  submissionId: text                  // nullable FK
  note: text
  createdAt: timestamp_ms
}

partnerPayoutBatches {
  id: text PK                         // uuid
  projectId: text FK projects.id
  csvR2Key: text                      // R2 key for the exported CSV
  rowCount: integer
  totalAmount: real                   // sum of reward amounts
  txHash: text                        // populated when partner reports payout
  paidAt: timestamp_ms
  verifiedOnChain: boolean default false  // true after Cardano façade confirms
  recordedByUserId: text FK users.stakeAddress  // which admin recorded it
  createdAt: timestamp_ms
}

trackedLinks {
  id: text PK                         // uuid
  projectId: text FK projects.id
  taskId: text FK tasks.id            // nullable — some links are project-level
  userRefCode: text                   // nullable — for personal referral codes
  dubLinkId: text
  shortUrl: text
  destinationUrl: text
  createdAt: timestamp_ms
}

clickEvents {                         // synced from Dub webhooks
  id: integer PK autoinc
  trackedLinkId: text FK trackedLinks.id
  userId: text                        // resolved from refCode if present
  country: text
  referrer: text
  userAgent: text
  ts: timestamp_ms
}

auditLog {
  id: integer PK autoinc
  userId: text NOT NULL               // who made the change
  timestamp: timestamp_ms
  entityType: text                    // 'submission' | 'project' | 'task' | 'points' | 'payout_batch'
  entityId: text
  field: text
  oldValue: text
  newValue: text
}
```

### Idempotency invariants
- `submissions(userId, taskId, txHash)` UNIQUE — same tx can't be claimed for same task twice
- `pointsLedger` is append-only, never UPDATE
- `partnerPayoutBatches.txHash` UNIQUE when not null
- `users.refCode` UNIQUE

---

## Cardano façade pattern

Every Cardano data read goes through `src/lib/cardano/index.ts`. Verifiers never import `koios.ts` or `blockfrost.ts` directly.

```ts
// src/lib/cardano/index.ts
import * as koios from "./koios";
import * as blockfrost from "./blockfrost";

export async function getAccountInfo(stakeAddress: string) {
  try {
    const r = await koios.getAccountInfo(stakeAddress);
    if (r) return r;
  } catch (e) {
    console.warn("[cardano] koios.getAccountInfo failed, falling back to Blockfrost", e);
  }
  return blockfrost.getAccountInfo(stakeAddress);
}

// Same pattern for: getTxInfo, getDRepInfo, getStakePoolInfo, getAccountAssets, etc.
```

Both modules return the same TypeScript type. The provider-agnostic types live in `src/lib/cardano/types.ts`. When Koios and Blockfrost field names differ (and they do), normalise inside the provider module — never in the verifier.

**Which provider for what (default — adjust if a provider is missing an endpoint):**
- Account info, account history → Koios (`/account_info`) — has both `delegated_pool` and `delegated_drep` in one call
- DRep info, DRep metadata, CIP-119 profiles → Koios (`/drep_info`, `/drep_metadata`) — already implemented in sibling
- Transaction info → Koios (`/tx_info`), Blockfrost (`/txs/{hash}/utxos`) for richer UTxO breakdown
- DRep activity status (`expired`, `last_active_epoch`) → **Blockfrost** (`/governance/dreps/{drep_id}`) — Koios exposes registration but Blockfrost surfaces the protocol's authoritative `expired` flag

---

## Task types and verification logic

Every task type maps to one verifier in `src/lib/verification/`. The dispatcher in `src/lib/verification/index.ts` reads `task.taskType` and `task.taskConfig`, calls the right verifier, returns `{ status: 'verified' | 'rejected' | 'needs_review', reason?: string }`.

### Auto on-chain (Koios → Blockfrost fallback)

**`pool_delegation`** — config: `{ poolId?: string }`. Pass: `account_info.delegated_pool === config.poolId` (or any non-null if no specific pool). Re-check every 6h via cron; on un-delegation, optionally clawback (configurable per task).

**`drep_delegation`** — config: `{ drepId?: string, mustBeActive?: boolean }`. Pass: `account_info.delegated_drep === config.drepId` (or any non-key DRep). If `mustBeActive`, chain to `getDRepInfo(drep_id)` and require `expired === false`.

**`drep_registered`** — derive user's DRep ID from their stake credential via `drepIdFromRewardAddress()` (lifted from sibling), then `getDRepInfo(drep_id)`. Pass: `retired === false` AND `expired === false`. Optional stricter: `last_active_epoch >= currentEpoch - N`.

**`tx_swap`** — config: `{ scriptAddresses: string[], minAdaIn?: number }`. User submits tx hash. Verifier: `getTxInfo(txHash)` — confirm tx involves user's stake address AND contains output to one of `scriptAddresses` AND tx is after `task.startsAt`. Designed for DEX swaps where the script address identifies the DEX.

**`asset_purchase`** — config: `{ policyId: string, assetName?: string, minQuantity?: number }`. User submits tx hash. Verifier: confirm tx has an output to user's address containing asset matching policyId (+ assetName if specified) with `quantity >= minQuantity`. Catches ADAHandle, NFT buys, token mints.

**`governance_vote`** — config: `{ actionTxHash?: string }`. Verifier: `account_info` confirms DRep delegation, then `getDRepInfo` shows recent vote on the specified action (or any vote if unconfigured).

### Auto OAuth

**`x_tweet`** — config: `{ requiredHashtags: string[], requiredMentions: string[] }`. User submits tweet URL → verifier calls X API for tweet → checks text contains required tokens AND `tweet.author_id === user.xUserId` AND `tweet.created_at >= task.startsAt`.

**`x_retweet`** — config: `{ targetTweetId: string }`. Verifier checks user's recent retweets for `targetTweetId`.

**`youtube_comment`** — config: `{ videoId: string }`. Verifier calls YouTube Data API `commentThreads.list?videoId=...&allThreadsRelatedToChannelId=user.youtubeChannelId`. First match counts.

### Auto webhook

**`bounty_completion`** — config: `{ bountyId: string }`. No user submission — the Learn Cardano Bounty platform POSTs to `/api/webhooks/bounty` with `{ stake_address, bounty_id, completed_at, hmac_signature }`. Verifier confirms HMAC, creates a verified submission.

### Manual

**`manual_review`** — config: `{ instructions: string, requiresProofUrl?: boolean, requiresScreenshot?: boolean }`. User submits a URL and/or screenshot to R2. Submission lands in admin queue with status `pending`. Peter approves/rejects.

### Task config validation
Every `taskType` has a Zod schema for `taskConfig` in `src/lib/verification/<type>.ts`. The admin panel validates against it before saving. Never trust `taskConfig` to be the right shape at verify time — re-parse.

---

## Verification flow & async pattern

1. User submits proof via `submissions` POST. Submission inserted with `status='pending'`.
2. API handler enqueues to Cloudflare Queue: `{ submissionId }`.
3. API returns immediately with the new submission ID. Client polls `/api/submissions/[id]/route.ts` every 2s.
4. Queue consumer (`src/queues/verify-consumer.ts`) picks up the job:
   - Loads submission + task from D1
   - Sets `status='verifying'`
   - Dispatches to the right verifier
   - Updates submission status, inserts `pointsLedger` row if verified, logs to `auditLog`
5. Cron handler (`src/queues/cron-handler.ts`):
   - Every 6h: re-check `pool_delegation` and `drep_delegation` tasks that have `clawbackOnUndelegate` set
   - Every 1h: refresh leaderboard KV cache (`src/lib/leaderboard.ts`)
   - Every 24h: re-check active DRep status on `drep_registered` tasks
   - On batch payout recorded: verify the on-chain tx matches the CSV (mark batch `verifiedOnChain=true`)

**Queue retry policy:** 3 retries with exponential backoff. After final failure, submission goes to `status='rejected'` with `rejectionReason='verifier_unavailable'` and Peter gets an alert (admin badge count). Manual re-trigger via admin `/api/verify/[id]/route.ts`.

---

## Payout flow (partner-managed, lifted from earlier convo)

1. Admin → `/admin/payouts` → select project + date range → "Export winners".
2. Handler queries verified-and-unbatched submissions for that project, groups by user, emits CSV to R2: `payment_address, stake_address, total_reward, asset, submission_ids, completed_at`.
3. Creates `partnerPayoutBatches` row with `csvR2Key`, marks selected submissions `payoutBatchId=<batchId>`, status moves to `paid_pending`.
4. Peter hands the CSV to the project partner via whatever channel (email, Slack, etc.).
5. Partner runs their payout, returns a tx hash.
6. Peter pastes tx hash into admin → `/admin/payouts/[batchId]/record` → updates `txHash`, `paidAt`, `recordedByUserId`. Submissions move to `paid`.
7. Cron handler picks up `paid` batches with `verifiedOnChain=false` → `getTxInfo(txHash)` confirms outputs match CSV → marks batch and submissions `verified`.
8. If verification fails (under-pay, wrong asset, recipient mismatch), batch is flagged in admin UI for follow-up. Submissions stay `paid` but the batch shows `verifiedOnChain=false` with a discrepancy report.

**Trust signal on the public leaderboard:** projects with all batches verified show a "Payouts verified ✓" badge.

---

## Admin allow-list

`src/lib/admin.ts`:
```ts
export async function requireAdmin(): Promise<string> {
  const stake = await getCurrentStakeAddress();
  const ADMIN_STAKE_ADDRESSES = (env.ADMIN_STAKE_ADDRESSES ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!ADMIN_STAKE_ADDRESSES.includes(stake)) throw new Error("not_authorised");
  return stake;
}
```
- `ADMIN_STAKE_ADDRESSES` is a comma-separated list set as a Worker secret.
- Every admin route handler and server action starts with `const adminId = await requireAdmin();`.
- Peter's stake address is the only entry at launch.

---

## Deploy chain — copy verbatim from the sibling

### Build server
Linux build server: `/home/aiagent/.openclaw/workspace/campaign-leaderboard/` (mirroring the sibling's path). SMB share: `\\aiagent-machine\openclaw\campaign-leaderboard\`. SSH alias: `aiagent-linux`.

### Commands
```bash
# Tests (pure logic only)
npm test
npm run test:watch

# Typecheck
npx tsc --noEmit

# Migrations
npm run db:generate       # after editing src/db/schema.ts
npm run db:migrate:local  # for `next dev`
npm run db:migrate:remote # production

# Build + deploy
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy

# One-shot deploy chain — use this for any code-only change
git add -A && \
  git -c user.email=peter@learncardano.io -c user.name=Pete commit -m "..." && \
  npx opennextjs-cloudflare build && \
  npx opennextjs-cloudflare deploy && \
  git push
```

### Secrets to set before first deploy
```bash
wrangler secret put AUTH_SESSION_SECRET                   # random 32+ bytes, HMAC key
wrangler secret put NEXT_SERVER_ACTIONS_ENCRYPTION_KEY    # MUST also be in .env.local at build time
wrangler secret put BLOCKFROST_PROJECT_ID                 # mainnet
wrangler secret put DUB_API_KEY
wrangler secret put DUB_WEBHOOK_SECRET
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put BOUNTY_WEBHOOK_HMAC_SECRET            # shared with Cardano Bounties
wrangler secret put ADMIN_STAKE_ADDRESSES                 # comma-separated, Peter's stake at minimum
```

### Commit style — verbatim from sibling
Conventional, multi-line. Subject ≤ 70 chars, body explains *why* and lists what changed.

```bash
git -c user.email=peter@learncardano.io -c user.name=Pete commit -m "Verification: gate payout-eligible on partner tx confirmation

Verified submissions were being shown as payout-ready before the
partner's actual disbursement landed on-chain. Coverage cap mirroring
the DRep Dashboard's scorecard pattern — submissions only flip to
'reward_verified' once the partner batch tx is confirmed via Cardano
facade."
```

For multi-paragraph messages use a temp file:
```bash
cat > .commit-msg.txt <<'EOF'
…subject…

…body…
EOF
git add -A
git -c user.email=peter@learncardano.io -c user.name=Pete commit --file=.commit-msg.txt
rm .commit-msg.txt
git push
```

Never `--amend` and `--force-push` without an explicit reason from Peter.

---

## Conventions

### Imports
`@/` is the path alias to `src/`. Configured in `tsconfig.json` and `vitest.config.ts`. Use it always — never `../../../lib/foo`.

### Server actions
- Live in `actions.ts` files colocated with the page that uses them
- Always start with `"use server"`
- Always start the body with `const userId = await getCurrentStakeAddress();` (for user actions) or `const adminId = await requireAdmin();` (for admin actions)
- Use `save-form.tsx` (the full-reload pattern) on the client side — `revalidatePath` is unreliable

### Error handling in route handlers
```ts
export async function POST(req: Request) {
  try {
    // ...
    return NextResponse.json({ ok: true, ... });
  } catch (e) {
    if (e instanceof Error && e.message === "not_authenticated") {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof Error && e.message === "not_authorised") {
      return NextResponse.json({ error: "not_authorised" }, { status: 403 });
    }
    console.error("[route_name] unexpected", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
```

### Testing
- Vitest, node environment. Tests live next to the source file: `foo.ts` + `foo.test.ts`.
- Test pure logic only: verifiers given mocked Cardano façade responses, scoring math, rule engine, points ledger arithmetic, session sign/verify, stake-address derivation.
- Don't test against real D1 or KV — mock at the function boundary.
- Aim for tests on every verifier in `src/lib/verification/`.

### Logging
- `console.log` for normal flow, `console.warn` for recoverable issues, `console.error` for unexpected. Cloudflare Observability is enabled in `wrangler.jsonc`.
- Prefix every log with `[module_name]` for grep-ability: `[verify:tx_swap]`, `[cardano:koios]`, `[queue:consumer]`.
- Never log full tx hashes if it would aid de-anonymisation — log first/last 8 chars only when in user-visible scope. Inside admin/audit paths, full hashes are fine.

### Privacy
- Onboarding survey data (age, country, experience) is PII. Never exposed via any public API. Admin-only.
- Stake address is the public ID. Show truncated form `stake1…ab1234` everywhere except admin views.
- Never store payment passwords, mnemonics, or any wallet seed material. The app is sign-in only.

### CSS / theme
- Tailwind 4 with CSS variables on `:root` (see sibling's `src/app/globals.css`). Track WCAG AA contrast in code comments.
- Don't introduce arbitrary colour values — use the CSS vars.
- Don't introduce a UI library (no Radix, shadcn pre-built blocks, etc.) without permission. Match the sibling's hand-rolled component style.

### What NOT to add without asking
- Email service (SendGrid, Resend, etc.)
- Push notifications
- A second framework (Astro for static pages, Svelte for islands, etc.)
- AI features (LLM calls from the app)
- Analytics SDKs (Posthog, Mixpanel, GA) beyond Dub and Cloudflare Web Analytics
- A "minimal" auth provider that bypasses CIP-30

---

## Phased delivery

The brief is comprehensive. Build in this order — do not skip phases.

**Phase 0 — Scaffold (2 days)**
- Create repo, copy verbatim configs from sibling, set up wrangler.jsonc with new D1/KV/R2/Queue IDs
- Port `session.ts`, `auth.ts`, `audit.ts`, `db/client.ts`, wallet components
- Port `koios.ts` to `src/lib/cardano/koios.ts` with rename + add `getAccountInfo`, `getTxInfo`
- Stub `blockfrost.ts` mirror
- Set up the Cardano façade `src/lib/cardano/index.ts`
- First migration: `users`, `audit_log` only
- Wire up `/api/auth/{nonce,verify,signout}` with stake-address identity
- Landing page with locked teaser + connect/sign-in flow
- Onboarding survey page
- Deploy to subdomain `campaign-preview.learncardano.io`

**Phase 1 — Projects, tasks, manual verification (1 week)**
- `projects`, `tasks`, `submissions`, `points_ledger` migrations
- Admin allow-list + admin pages for project/task CRUD
- Project gallery + per-project detail
- Submission form (manual review only — R2 upload, proof URL)
- Admin submission review queue
- Public leaderboard (no KV cache yet — just direct query)
- Points awarded on admin approval

**Phase 2 — On-chain auto-verification (1 week)**
- Cloudflare Queues binding + consumer Worker
- Verifiers: `tx_swap`, `asset_purchase`, `pool_delegation`, `drep_delegation`, `drep_registered`, `governance_vote`
- Submission flow updated: submit tx hash → enqueue → poll
- Cron handler for delegation re-checks
- Leaderboard KV cache (30s TTL)

**Phase 3 — Social verification + click tracking (1 week)**
- X OAuth + verifier
- YouTube OAuth + verifier
- Dub.co integration — auto-create links on project save
- Dub webhook receiver → `click_events`
- Personal referral codes + invited-by tracking
- Share-card PNG generator (SVG → R2)

**Phase 4 — Bounties integration + payout flow (3 days)**
- Bounty webhook receiver (HMAC verified)
- `partner_payout_batches` migration
- Admin payout CSV export
- Admin tx-hash record + on-chain verification cron
- Public "Payouts verified" badge

**Phase 5 — Polish (ongoing)**
- Streaks, daily check-in bonus
- Spotlight-week mechanic
- Tiered leaderboards (points, projects-engaged, referrals)
- Mobile pass

Don't start Phase N until Phase N-1 is deployed to the preview subdomain and Peter has tested the happy path.

---

## When in doubt

1. Check if the sibling project has solved it. It probably has.
2. Read the relevant Cardano CIP rather than guessing API behaviour.
3. Ask Peter rather than improvising — for product decisions, naming, partner-relationship implications, anything where ecosystem trust is at stake.
4. Prefer "boring code" — the sibling project's style is functional, explicit, and readable. Don't add abstractions until duplication actually hurts.

---

## Reference — open issues for Peter to decide

These don't block scaffolding but need answers before the relevant phase:

- **Phase 1**: Final naming — "Campaign Leaderboard" vs "Learn Cardano Quests" vs other. Subdomain.
- **Phase 1**: Onboarding survey question wording, age-bracket cutoffs.
- **Phase 2**: Default points scale (10/50/100/500 tiers?), bonus multipliers.
- **Phase 3**: X handle/account requirements — must they follow @LearnCardano? @astroboysoup?
- **Phase 3**: Referral bonus formula — flat points per signup, or % of invitee's lifetime points?
- **Phase 4**: Bounty platform webhook spec — match the Bounties repo, share types.
- **Phase 4**: Default reward asset per partner — ADA, partner token, ADAHandle drop, NFT?
- **Ongoing**: Anti-sybil — minimum ADA balance? Minimum wallet age? KYC tier for top prizes?
