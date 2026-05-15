# Product brief — Learn Cardano Leaderboard

## What it is

A wallet-gated, public-leaderboard hub where Cardano users complete **tasks** issued by partnered projects — on-chain (delegate to a pool, swap on a DEX, mint an NFT, vote on a governance action), social (post a tweet, comment on a YouTube video), and off-chain (complete a bounty on Learn Cardano Bounties). Verified completions award **points** and (optionally) **token rewards**. Points feed a public leaderboard. Token rewards are paid out by the partner directly to the user's Cardano stake address, with on-chain verification of the payout closing the loop.

## Who it's for

- **Cardano newcomers** building first-hand experience of the ecosystem one task at a time.
- **Active ADA holders** looking for curated, high-signal ways to use Cardano apps without trawling Twitter.
- **Partner projects** wanting structured campaigns with on-chain proof of engagement and verifiable payout trails.
- **Peter (host)** running it day-to-day — admin panel, payout exports, audit log.

## Why it exists

Cardano's discovery problem is real: even highly engaged users miss launches, governance actions, and bounty opportunities. Existing engagement campaigns are off-chain, unverifiable, and gameable. This dashboard makes engagement **verifiable**, **payouts transparent**, and **partner trust the default**.

## Design principles

- **Wallet is the only identity.** No email, no password. Stake address is the user ID. Onboarding survey is optional (but unlocks the personal dashboard and referral code).
- **On-chain when possible.** A Koios → Blockfrost façade verifies every claim it can without trusting the user.
- **Manual review when it must be.** Some tasks (creative content) need a human. The admin queue is first-class.
- **Trust signals are loud.** "Payouts verified ✓" on partner project pages. Audit log on every admin action. Build hash in the footer.
- **No dark patterns.** No streaks that punish a missed day. No FOMO timers that aren't real. Points-for-engagement, never points-for-attention.

## Surfaces

| Surface | Path | Gated? | Purpose |
|---|---|---|---|
| Landing | `/` | Public (locked teaser) | What it is, "Connect wallet to enter" |
| Leaderboard | `/leaderboard` | Wallet-required | Top N users by points, project filter, badges |
| Projects gallery | `/projects` | Wallet-required | Tiled cards per partner project |
| Project detail | `/projects/[slug]` | Wallet-required | Project description, tasks, referral link, payout-verified badge |
| Onboarding | `/me/onboarding` | First-time user | Age bracket, country, experience, referral source |
| Personal dashboard | `/me` | Owner-only | Points, submissions, OAuth links, settings, referral code, **privacy toggle** |
| Public profile | `/u/[stakeAddress]` | Public if user opts in | Shareable points/badges/verified-tasks page |
| Admin home | `/admin` | Stake-address allow-list | Submissions queue, projects, tasks, payouts, audit log |

## Personal dashboard + public profile (added vs. original CLAUDE.md spec)

- `/me` — owner-only. Points, recent submissions, verified tasks, social account links, referral code, **profile privacy toggle** (`public` / `private`, default public).
- `/u/[stakeAddress]` — public profile page if the user's privacy toggle is `public`. Shows points, badges, verified task summaries, OG/Twitter card with their handle and tier. Onboarding survey fields (age, country, experience) are NEVER rendered. If toggle is `private` the page returns 404.
- A share button on `/me` copies the canonical `/u/<stake>` URL. The share card is the same `share-card.tsx` SVG→PNG generator used for individual task share-outs, but parameterised for a full profile.
- DB: `users.profileVisibility text default 'public'` ('public' | 'private'). Migration lands with the rest of `users` in Phase 0.
- This surface is **a nice-to-have**, but cheap to scaffold from the start. See [`lifted-from-drep-dashboard.md`](lifted-from-drep-dashboard.md) for which patterns it reuses.

## SEO and social metadata

Mandatory from day one, mirroring the sibling's `src/app/layout.tsx`:

- `metadata` export on `src/app/layout.tsx` with `metadataBase`, `title.template`, `description`, `keywords`, full `openGraph` (siteName "Learn Cardano", 1731×909 OG image at `/og-image.png`), `twitter` summary_large_image with `@astroboysoup`.
- Page-specific titles via `generateMetadata()` on `/projects/[slug]/page.tsx`, `/u/[stakeAddress]/page.tsx`, `/leaderboard/page.tsx`.
- Favicons + apple-touch-icon + site.webmanifest under `/public/`.
- `robots.txt` allowing all but `/api/`, `/admin/`.
- `sitemap.ts` route emitting `/`, `/leaderboard`, every active project, every public `/u/<stake>`.
- Per-project share card PNG generated at task-verified time (R2-cached) and referenced as the project's twitter image.

## Out of scope for v1

- Email notifications. No SendGrid, no Resend.
- Push notifications.
- Mobile apps. Mobile **web** is in scope (Phase 5 pass).
- AI features. No LLM calls.
- Third-party auth providers (Discord, Google as a login). Wallet is auth.

## Open product decisions

Tracked in [`CLAUDE.md` § Reference — open issues for Peter to decide](../CLAUDE.md).
