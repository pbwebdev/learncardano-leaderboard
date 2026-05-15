# Port log — files lifted from `cardano-drep-dashboard`

The sibling project ships in production and has already paid the debugging tax for the Next 16 + OpenNext + Cloudflare + CIP-30 stack. **Never rewrite a file in this list from scratch.** Open the sibling, apply the rename rules below, copy it across.

Sibling root (Windows): `Z:\cardano\cardano-drep-dashboard\`
Sibling root (linux build box): `/home/aiagent/.openclaw/workspace/cardano-drep-dashboard/`

## Legend

- 🟢 **Verbatim** — copy file, zero logic changes (renames in constants only).
- 🟡 **Minimal renames** — copy file, rename identifiers per the table.
- 🟠 **Extended** — copy the file, then add endpoints/fields. Don't rewrite existing logic.
- 🔵 **Pattern only** — don't copy the file, mirror the approach.

## Configs

| File | Status | Notes |
|---|---|---|
| `next.config.ts` | 🟢 | Includes the `gitShortHash()` + `NEXT_PUBLIC_BUILD_HASH` / `NEXT_PUBLIC_BUILD_TIME` trick. |
| `open-next.config.ts` | 🟢 | |
| `drizzle.config.ts` | 🟢 | |
| `vitest.config.ts` | 🟢 | Node env, `@/` alias. |
| `tsconfig.json` | 🟢 | |
| `postcss.config.mjs` | 🟢 | |
| `eslint.config.mjs` | 🟢 | |
| `.gitignore` | 🟢 | Already lifted. Keeps `.open-next/`, `.wrangler/`, `.dev.vars`, `cloudflare-env.d.ts`, `.env*`. |
| `AGENTS.md` | 🟢 | Already lifted. |
| `wrangler.jsonc` | 🟡 | New D1, KV, R2, Queue, Cron Trigger IDs. Worker name `learncardano-leaderboard`. |
| `package.json` | 🟡 | Same scripts and dep set. Rename `name` to `learncardano-leaderboard`. **Add** Queue + Cron binding-related deps if any. |

## `src/lib/`

| File | Status | Renames |
|---|---|---|
| `session.ts` | 🟢 | `SESSION_COOKIE = "leaderboard_session"`; `SessionPayload = { stake_address }`; `signSession(stakeAddress)`. |
| `audit.ts` | 🟢 | Param `drepId` → `userId` (stake address). DB shape same. |
| `auth.ts` | 🟡 | `getCurrentDRepIdOrNull` → `getCurrentStakeAddressOrNull`, `getCurrentDRepId` → `getCurrentStakeAddress`. Drop `OWNER_DREP_ID` fallback, replace with `OWNER_STAKE_ADDRESS`. `ALLOW_ENV_AUTH=false` in prod. |
| `koios.ts` → `cardano/koios.ts` | 🟠 | Keep `koiosPost`, `cached`, `formatAda`, `getDRepInfo`, `getDRepMetadata`, `getDRepProfile`. Add `getAccountInfo`, `getAccountAssets`, `getAccountHistory`, `getTxInfo`, `getTxStatus`, `getPoolInfo`, `getVoterProposalList`. |
| `cardano/index.ts` (façade) | 🔵 | New file. Koios-first, Blockfrost-fallback. Verifiers depend on this, not on koios/blockfrost directly. |
| `cardano/blockfrost.ts` | 🔵 | Mirror Koios surface. |
| `cardano/types.ts` | 🔵 | Provider-agnostic types. |
| `stake-address.ts` | 🔵 | Bech32 helpers — a subset of sibling's `drep-id.ts`. |
| `points.ts` | 🔵 | Mirrors sibling's `scoring.ts` coverage-cap state machine for payout-readiness. |
| `leaderboard.ts` | 🔵 | KV-cached top-N query. New. |
| `dub.ts` | 🔵 | New. Dub.co client. |
| `admin.ts` | 🔵 | New. Allow-list `requireAdmin()`. |

## `src/db/`

| File | Status | Notes |
|---|---|---|
| `client.ts` | 🟢 | |
| `schema.ts` | 🔵 | New. See [`../CLAUDE.md` § Data model](../CLAUDE.md). |

## `src/components/`

| File | Status | Renames |
|---|---|---|
| `wallet-gate.tsx` + `wallet-gate-inner.tsx` | 🟢 | Fallback copy → "Connect your wallet from the header to view the leaderboard". |
| `local-time.tsx` | 🟢 | |
| `save-form.tsx` | 🟢 | Full-reload pattern. Port verbatim when first server action lands. |
| `nav-link.tsx` | 🟢 | |
| `scammer-easter-egg.tsx` (+ trigger) | 🟢 | Footer Easter egg. Per Peter, port this across. |
| `wallet-button.tsx` + `wallet-button-client.tsx` | 🟡 | **Drop** CIP-95 / `getPubDRepKey()` block. **Drop** `extensions: [{ cip: 95 }]` from `wallet.enable()`. Signed message has no `\nDRep: drep1…` suffix. POST body to `/api/auth/verify` has no `drep_id` field. |
| `leaderboard-table.tsx`, `project-tile.tsx`, `task-card.tsx`, `submission-form.tsx`, `share-card.tsx` | 🔵 | New. Match the sibling's hand-rolled style — no UI library. |

## `src/app/`

| File | Status | Notes |
|---|---|---|
| `layout.tsx` | 🟡 | Header/nav/footer structure verbatim. Replace metadata block with leaderboard-specific copy (siteName "Learn Cardano", title default "Learn Cardano Leaderboard", description, OG image at `/og-image.png`, Twitter `@astroboysoup`). Replace `getCurrentDRepIdOrNull` with `getCurrentStakeAddressOrNull`. Footer `ScammerEasterEgg` + `ScammerEasterEggTrigger` ported as-is. Build hash + LocalTime block verbatim. |
| `globals.css` | 🟢 | Tailwind 4 + CSS vars on `:root`. Keep WCAG AA comments. |
| `page.tsx` | 🔵 | New landing — locked teaser + connect/sign-in CTA. |
| `api/auth/nonce/route.ts` | 🟡 | Message template loses the `DRep:` line. 24-byte hex nonce, 5 min KV TTL. |
| `api/auth/verify/route.ts` | 🟡 | Body drops `drep_id`. Replace `drepIdFromRewardAddress` derivation with bech32 sanity check `/^stake1[0-9a-z]+$/`. **Keep the two-step `verifyDataSignature` fallback verbatim** — strict-then-crypto-only retry. On success `await signSession(stake_address_bech32)`. |
| `api/auth/signout/route.ts` | 🟢 | |
| `me/page.tsx` | 🔵 | New. Personal dashboard. Includes profile visibility toggle. |
| `me/onboarding/page.tsx` | 🔵 | New. |
| `u/[stakeAddress]/page.tsx` | 🔵 | New. Public profile (404 when visibility=private). Survey fields never rendered. |
| `leaderboard/page.tsx` | 🔵 | New. |
| `projects/page.tsx`, `projects/[slug]/page.tsx` | 🔵 | New. |
| `admin/**` | 🔵 | New. Allow-list gated. |
| `api/submissions/[id]/route.ts`, `api/verify/[id]/route.ts`, `api/webhooks/{dub,bounty}/route.ts`, `api/oauth/{x,youtube}/{start,callback}/route.ts` | 🔵 | New. |
| `sitemap.ts`, `robots.ts` | 🔵 | New. Required for SEO. |

## `public/`

Lift the sibling's favicon set verbatim (favicon.ico, 16/32 PNG, android-chrome 192/512, apple-touch-icon, site.webmanifest). Replace `og-image.png` with a leaderboard-themed image at 1731×909.

## Pattern-only ports

- **Coverage-cap state machine** from `src/lib/scoring.ts` → mirrored in `src/lib/points.ts` for payout-readiness gating.
- **Audit log invocations** — every admin write logs via `logChange()`. Same call shape as sibling.
- **Server-action save flow** — every server action uses `save-form.tsx` on the client side. Never trust `revalidatePath()`.
- **Error envelope in route handlers** — `not_authenticated` → 401, `not_authorised` → 403, anything else → 500 with `[module] unexpected` log. Verbatim shape.

## When you find a sibling file that isn't listed here

Check `Z:\cardano\cardano-drep-dashboard\` before writing equivalent code from scratch. If a useful file exists, add it to this log with the appropriate status flag and proceed.
