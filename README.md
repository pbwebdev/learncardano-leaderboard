<!--

███╗   ███╗███████╗███████╗██╗  ██╗    ██╗    ██╗██╗████████╗██╗  ██╗    ██╗   ██╗███████╗
████╗ ████║██╔════╝██╔════╝██║  ██║    ██║    ██║██║╚══██╔══╝██║  ██║    ██║   ██║██╔════╝
██╔████╔██║█████╗  ███████╗███████║    ██║ █╗ ██║██║   ██║   ███████║    ██║   ██║███████╗
██║╚██╔╝██║██╔══╝  ╚════██║██╔══██║    ██║███╗██║██║   ██║   ██╔══██║    ██║   ██║╚════██║
██║ ╚═╝ ██║███████╗███████║██║  ██║    ╚███╔███╔╝██║   ██║   ██║  ██║    ╚██████╔╝███████║
╚═╝     ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝     ╚══╝╚══╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝     ╚═════╝ ╚══════╝

Built by Mesh With Us
https://meshwithus.com.au

-->

# Learn Cardano Leaderboard

A wallet-gated dashboard where users complete on-chain and off-chain tasks across partnered Cardano projects to earn points, climb a public leaderboard, and unlock token rewards.

Host: Peter Bui (Learn Cardano / DRep / Cardano Ambassador).
Sibling project: [`cardano-drep-dashboard`](https://cardano-drep-dashboard.learncardano.io) — most patterns here are ported from it.

## Stack

Next.js 16 (App Router, RSC) · Cloudflare Workers via `@opennextjs/cloudflare` · D1 + Drizzle · KV · R2 · Queues · Cron Triggers · CIP-30 wallets · Koios (Blockfrost fallback) · Vitest · Tailwind 4.

## Read order for any new task

1. [`AGENTS.md`](AGENTS.md) — Next.js 16 + Cloudflare Workers + Cardano landmine warnings. ~30 seconds.
2. [`CLAUDE.md`](CLAUDE.md) — Full project contract. Architecture, data model, port log, conventions, phasing, deploy chain.
3. [`GOTCHAS.md`](GOTCHAS.md) — 21 specific failure modes with the bite, fix, and smell test for each.
4. [`docs/brief.md`](docs/brief.md) — Product brief.
5. [`docs/lifted-from-drep-dashboard.md`](docs/lifted-from-drep-dashboard.md) — File-by-file port log from the sibling.
6. [`docs/task-types.md`](docs/task-types.md) — Spec for every task verification method.
7. [`docs/admin-runbook.md`](docs/admin-runbook.md) — How the admin panel is operated.

## Status

Scaffolding stage. See [`CLAUDE.md` § Phased delivery](CLAUDE.md) for what lands when.

## Author

Pete · [peter@learncardano.io](mailto:peter@learncardano.io) · [learncardano.io](https://learncardano.io)
Built by [Mesh With Us](https://meshwithus.com.au).
