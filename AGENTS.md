@AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This project uses Next.js 16 — APIs, conventions, and file structure may differ from your training data. Several patterns have changed in ways that compile without errors but break at runtime. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next-specific code. Heed deprecation notices.

The fastest landmines: `cookies()` / `headers()` / `params` / `searchParams` are async — `await` them. `useFormState` is now `useActionState` and lives in `react`, not `react-dom`. Caching defaults flipped between versions — don't assume either direction, be explicit.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:cloudflare-workers-rules -->
# This deploys to Cloudflare Workers via OpenNext, not Vercel

`@opennextjs/cloudflare` bundles Next.js into a single Worker. The runtime is Workers, not Node, not Edge in the generic Next sense.

The killers: `revalidatePath()` is unreliable for refreshing RSC payload after server actions — use the full-reload pattern in `src/components/save-form.tsx`. Cloudflare bindings (D1, KV, R2, Queues) and Wrangler secrets are read via `getCloudflareContext().env`, NOT `process.env`. Every route handler that touches a binding must set `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Use Web Crypto (`crypto.subtle`), not Node's `crypto` module.
<!-- END:cloudflare-workers-rules -->

<!-- BEGIN:cardano-rules -->
# Cardano data access goes through one facade

Verifiers, page loaders, and admin tools call `src/lib/cardano/index.ts` only — never `koios.ts` or `blockfrost.ts` directly. The facade implements Koios-first, Blockfrost-fallback. CIP-30 wallets touch `window` at import time — wrap any component using `useCardano` in `dynamic(..., { ssr: false })`.
<!-- END:cardano-rules -->

---

**See `CLAUDE.md` for the full project contract and `GOTCHAS.md` for the complete landmine field manual. Read both before writing code.**
