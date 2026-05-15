# Task types

Each task in the `tasks` table has a `taskType` discriminator and a `taskConfig` JSON blob. The dispatcher in `src/lib/verification/index.ts` reads both and routes to the right verifier. Every verifier returns `{ status: 'verified' | 'rejected' | 'needs_review', reason?: string }`.

Every `taskConfig` shape is parsed at verify time via a Zod schema colocated with its verifier (`src/lib/verification/<type>.ts`). Never trust the admin save to keep config valid — re-parse.

## Auto on-chain (Cardano façade — Koios primary, Blockfrost fallback)

### `pool_delegation`
**Config**
```ts
{ poolId?: string, clawbackOnUndelegate?: boolean }
```
**Verifier** — `src/lib/verification/delegation.ts`
1. `cardano.getAccountInfo(user.stakeAddress)`
2. Pass: `account.delegated_pool === config.poolId` (or any non-null if no `poolId`)
3. Tx-age guard: reject if `account.delegation_active_epoch_no` < epoch at `task.startsAt`.

**Cron re-check**: every 6h. If `clawbackOnUndelegate` and account no longer delegated, append `-N` to `pointsLedger` with reason `clawback`.

### `drep_delegation`
**Config**
```ts
{ drepId?: string, mustBeActive?: boolean }
```
**Verifier** — `src/lib/verification/delegation.ts`
1. `getAccountInfo` → check `delegated_drep === config.drepId` (or any non-key DRep)
2. If `mustBeActive`: chain to `cardano.getDRepInfo(drep_id)` and require `expired === false`.

### `drep_registered`
**Config**
```ts
{ requireActiveLastEpochs?: number }
```
**Verifier** — `src/lib/verification/drep-activity.ts`
1. Derive user DRep ID from stake credential via `drepIdFromRewardAddress()` (port from sibling).
2. `cardano.getDRepInfo(drep_id)`.
3. Pass: `retired === false` AND `expired === false`. If `requireActiveLastEpochs` set, also require `last_active_epoch >= currentEpoch - N`.

Cron re-check every 24h. DRep expiry status uses **Blockfrost** as the authoritative source (Koios exposes registration; Blockfrost surfaces protocol `expired`).

### `tx_swap`
**Config**
```ts
{ scriptAddresses: string[], minAdaIn?: number }
```
**Verifier** — `src/lib/verification/tx-hash.ts`
1. User submits a tx hash. Schema-validate the hash (`/^[0-9a-f]{64}$/`).
2. `cardano.getTxInfo(txHash)`.
3. Pass:
   - Tx involves `user.stakeAddress` (input from a payment address owned by that stake), AND
   - Tx has at least one output to an address in `config.scriptAddresses`, AND
   - `tx.block_time >= task.startsAt` (epoch seconds), AND
   - If `minAdaIn`, sum of user-side inputs in lovelace ≥ `minAdaIn × 1e6`, AND
   - `tx.num_confirmations > 0` at verify time (else `needs_review` with `reason='unconfirmed'`).
4. Unique-index check: `(userId, taskId, txHash)` — re-claim attempts return `rejected` with `reason='already_claimed'`.

### `asset_purchase`
**Config**
```ts
{ policyId: string, assetName?: string, minQuantity?: number }
```
**Verifier** — `src/lib/verification/tx-hash.ts`
1. User submits a tx hash.
2. `cardano.getTxInfo(txHash)`.
3. Pass: tx has output to a payment address owned by `user.stakeAddress`, containing an asset with `policyId` (and `assetName` if specified), quantity `≥ minQuantity` (default 1).
4. Tx-age guard. Confirmations > 0. Unique-index check.

### `governance_vote`
**Config**
```ts
{ actionTxHash?: string }
```
**Verifier** — `src/lib/verification/governance.ts`
1. `getAccountInfo` confirms DRep delegation.
2. `getDRepInfo` returns recent votes. Pass: vote on `actionTxHash` exists (or any vote within `task.startsAt..endsAt` if unconfigured).

## Auto OAuth

### `x_tweet`
**Config**
```ts
{ requiredHashtags: string[], requiredMentions: string[] }
```
**Verifier** — `src/lib/verification/social-x.ts`
1. Require `user.xUserId` populated (X OAuth complete). Else `rejected` with `reason='no_x_account'`.
2. User submits a tweet URL → extract tweet ID.
3. `GET https://api.twitter.com/2/tweets/{id}?expansions=author_id&tweet.fields=created_at,text`.
4. Pass: `tweet.author_id === user.xUserId`, `tweet.created_at >= task.startsAt`, text contains every `requiredHashtag` and every `requiredMention`.

### `x_retweet`
**Config**
```ts
{ targetTweetId: string }
```
**Verifier** — `src/lib/verification/social-x.ts`
1. Require `user.xUserId`.
2. `GET https://api.twitter.com/2/users/{xUserId}/retweets/of/{targetTweetId}` — pass if present in `data`.

### `youtube_comment`
**Config**
```ts
{ videoId: string }
```
**Verifier** — `src/lib/verification/social-youtube.ts`
1. Require `user.youtubeChannelId` populated.
2. `GET https://www.googleapis.com/youtube/v3/commentThreads?videoId={videoId}&allThreadsRelatedToChannelId={user.youtubeChannelId}&part=snippet`.
3. Pass: at least one item where `snippet.topLevelComment.snippet.authorChannelId.value === user.youtubeChannelId`.

## Auto webhook

### `bounty_completion`
**Config**
```ts
{ bountyId: string }
```
**Receiver** — `src/app/api/webhooks/bounty/route.ts`
- Body: `{ stake_address, bounty_id, completed_at, hmac_signature }`.
- HMAC verified against `BOUNTY_WEBHOOK_HMAC_SECRET` (HMAC-SHA256 over `${stake_address}.${bounty_id}.${completed_at}`).
- Find task by `bountyId`, find user by stake address. If both exist and HMAC verifies, create submission with `status='verified'` directly. Append to `pointsLedger`. Log `auditLog`.
- Idempotency: `(userId, taskId)` UNIQUE for `bounty_completion` tasks.

## Manual

### `manual_review`
**Config**
```ts
{ instructions: string, requiresProofUrl?: boolean, requiresScreenshot?: boolean }
```
**Flow**
1. User submits proof URL and/or screenshot (uploaded to R2 by the server action, `proofR2Key` set).
2. Submission status `pending`. No verification enqueued.
3. Admin queue shows submission; admin reviews; approve sets `status='verified'`, reject sets `status='rejected'` with `rejectionReason`.
4. Admin actions logged to `auditLog`.

## What every verifier must do

- Return one of `verified | rejected | needs_review` only.
- `needs_review` means an upstream API was unavailable — queue will retry per the policy in [`../CLAUDE.md` § Verification flow](../CLAUDE.md).
- Never call `koios.ts` / `blockfrost.ts` directly. Always go through `src/lib/cardano/index.ts`.
- Re-parse `taskConfig` against its Zod schema before reading any field.
- Have a unit test in the same directory exercising at least: one happy path, one rejection per failure mode, one `needs_review` for upstream failure.
