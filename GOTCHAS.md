# GOTCHAS — read before you write

This is the landmine document. Every item below has cost real debugging time on the sibling Cardano DRep Dashboard project. They're failure modes where the obvious code compiles fine, looks right, sometimes even works locally — and then breaks in production in subtle, hard-to-trace ways. **The CLAUDE.md file is the contract; this file is the field manual for not stepping on mines.**

Treat your default instincts on each topic below as a signal to stop and check, not to proceed. If you find yourself writing code that looks like the "DON'T" examples here, you are about to repeat a debugging session that has already been paid for.

---

## 1. Next.js 16 — APIs have changed from older versions

**The bite.** Your training data is densest on Next.js 13 and 14. This project is on Next.js 16. Several APIs have changed in ways that compile without errors but break at runtime.

**The fix.** Before writing any Next.js-specific code (route handlers, server components, middleware, server actions, image, link, metadata, font, anything in `next/*`), read the relevant file in `node_modules/next/dist/docs/`. The docs that ship with the installed version are guaranteed to match the runtime.

**Specific traps.**

`cookies()`, `headers()`, `draftMode()` are async in Next 15+. Always:

```ts
// DO
const cookieStore = await cookies();
const value = cookieStore.get("session")?.value;

// DON'T
const cookieStore = cookies();          // compiles, returns a Promise
const value = cookieStore.get("session")?.value;  // crashes at runtime
```

Route `params` and `searchParams` in dynamic segments are also async. Type them as `Promise<{ id: string }>`, not `{ id: string }`, and `await` before use.

`useFormState` was renamed to `useActionState` and moved from `react-dom` to `react`:

```ts
// DO (Next 15+, React 19)
import { useActionState } from "react";

// DON'T
import { useFormState } from "react-dom";  // ✗ removed
```

Caching defaults have flipped. In older Next, `fetch()` and route handlers were cached by default. From Next 15 onward, they're uncached by default. Don't assume either direction — be explicit. Route handlers that touch D1, KV, or any binding **must** set:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

Every auth route, every binding-touching route in the sibling sets both. Don't omit them.

**Smell test.** If you write Next.js code and feel zero hesitation about the API, that's the moment to pause. The framework has moved.

---

## 2. OpenNext + Cloudflare Workers — this is not Vercel

**The bite.** Next.js on Cloudflare via `@opennextjs/cloudflare` is a different deployment target from Vercel. Some Next.js features that are documented as "just work" do not, in fact, just work on Workers. Code that runs perfectly on Vercel can silently misbehave or fail outright on the Worker runtime.

**The two killers.**

### `revalidatePath` is unreliable
On OpenNext Cloudflare, `revalidatePath()` does not reliably push a fresh RSC payload to the client after a server action. The action completes, the database is updated, but the page the user sees still shows stale data. This has cost hours of "why isn't my update showing up" debugging.

**The fix.** Don't use `revalidatePath` for any save-then-redisplay flow. Use the full-reload pattern from `src/components/save-form.tsx` in the sibling repo (port it verbatim):

1. After the server action succeeds, the client stashes `window.scrollY` in `sessionStorage`.
2. Fades out the body (`opacity: 0` with a 200ms transition, respecting `prefers-reduced-motion`).
3. Calls `window.location.reload()`.
4. On mount in the reloaded page, reads sessionStorage and restores scroll with `requestAnimationFrame`.

It looks heavyweight. It is the only thing that actually works. Don't try to be clever and re-introduce `revalidatePath` — you will regret it.

### `process.env` does not work for bindings
On Workers, Cloudflare bindings (D1, KV, R2, Queues, Durable Objects) and Wrangler `vars`/secrets are accessed through `getCloudflareContext().env`, **not** `process.env`.

```ts
// DO
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  const { env } = getCloudflareContext();
  const value = await env.KV.get("key");
  const secret = env.AUTH_SESSION_SECRET;
  // ...
}

// DON'T
const secret = process.env.AUTH_SESSION_SECRET;     // undefined on Workers
const value = await process.env.KV.get("key");      // crash, KV isn't an env var
```

This applies to library code too — `src/lib/session.ts`, `src/lib/cardano/koios.ts`, every module that reads a binding or secret goes through `getCloudflareContext()`. The function is cheap to call; call it inside the function that needs the env, not at module scope (module scope evaluates before the Cloudflare context is available).

**Smell test.** If you see `process.env.SOMETHING` in code that runs in production, it's a bug.

---

## 3. Server actions need a stable encryption key

**The bite.** Next.js encrypts server action IDs with a key. If the key isn't stable across builds, every deploy regenerates the IDs — and any browser tab open during the deploy gets a "missing action" error the next time the user submits a form.

**The fix.** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be:
1. Set as a build-time env in `.env.local` (gitignored)
2. **Also** set as a Worker secret: `wrangler secret put NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
3. The two values must be identical
4. Set this **before** the first production deploy. Adding it later means a one-time breakage for any user with an old tab.

Generate a key once:

```bash
openssl rand -base64 32
```

Add it to both places, never rotate it without a coordinated breaking-deploy plan.

**Smell test.** If `.env.local` doesn't have this variable, or `wrangler secret list` doesn't show it, you're one deploy away from broken forms.

---

## 4. CIP-30 wallets touch `window` at import time

**The bite.** The `@cardano-foundation/cardano-connect-with-wallet` library inspects `window.cardano` during module evaluation. On the server, `window` doesn't exist, so importing the library SSRs into a crash.

**The fix.** Every component that uses `useCardano` or anything from that library **must** be dynamic-imported with `ssr: false`. The pattern from the sibling:

```ts
// wallet-button-client.tsx — the SSR-safe wrapper
"use client";
import dynamic from "next/dynamic";

const Inner = dynamic(() => import("./wallet-button").then((m) => m.WalletButton), {
  ssr: false,
  loading: () => <span className="..." />,  // skeleton
});

export function WalletButton(props) {
  return <Inner {...props} />;
}
```

Then `wallet-button.tsx` is the actual implementation, also `"use client"`, importing `useCardano` freely.

**Don't try to** put the `useCardano` hook directly in a server-imported client component. **Don't try to** import the wallet library at the top of a server component file. **Don't try to** lazy-load it inside an effect — the import itself crashes.

**Smell test.** If you see `import { useCardano } from "@cardano-foundation/..."` anywhere that isn't behind a `dynamic(() => ..., { ssr: false })`, you have a broken page on first load.

---

## 5. CIP-8 signature verification needs a defensive fallback

**The bite.** `@cardano-foundation/cardano-verify-datasignature` runs three checks internally: the cryptographic signature, an exact-match comparison of the signed message against the message you passed in, and an exact-match comparison of the embedded address. The latter two are encoding-sensitive (utf-8 vs hex, hashed vs unhashed flag) and disagree with different wallets in different ways. Eternl, Lace, Nami, Typhon all signed slightly differently on the sibling project — sometimes the lib accepted, sometimes it rejected, with no consistent rule.

**The fix.** Two-stage verify. Port verbatim from `src/app/api/auth/verify/route.ts`:

```ts
let cryptoVerified = false;
try {
  // First try: strict — pass message and address, lib does all three checks.
  cryptoVerified = verifyDataSignature(signature, key, message, stake_address_bech32);
  if (!cryptoVerified) {
    // Second try: crypto-only — if the signature is mathematically valid,
    // accept. We re-check message-contains-nonce ourselves (above) so the
    // "what was signed" is still verified, just by us instead of the lib.
    const sigOnly = verifyDataSignature(signature, key);
    if (sigOnly) cryptoVerified = true;
  }
} catch (e) {
  return NextResponse.json({ error: "signature_verify_threw" }, { status: 400 });
}
if (!cryptoVerified) {
  return NextResponse.json({ error: "signature_invalid" }, { status: 401 });
}
```

The nonce-in-message check (which you do yourself before this block) is what makes the fallback safe — you're not trusting a random signature, you're trusting a signature over a payload that includes the nonce you issued seconds ago.

**Don't try to** remove the fallback because "it should always pass strict". It won't, across the wallet ecosystem.

---

## 6. Git footer hash — commit BEFORE build

**The bite.** `next.config.ts` captures `git rev-parse --short HEAD` at build time and bakes it into `NEXT_PUBLIC_BUILD_HASH` for the footer. If you build before committing, the footer shows the previous commit's hash. Users see "we updated this" but the hash doesn't change, and you can't tell what's actually deployed.

**The fix.** Commit before build. Always. The one-shot deploy chain enforces this order:

```bash
git add -A && \
  git -c user.email=peter@learncardano.io -c user.name=Pete commit -m "..." && \
  npx opennextjs-cloudflare build && \
  npx opennextjs-cloudflare deploy && \
  git push
```

**Don't** swap the order. **Don't** build, then commit, then deploy — the build will have the wrong hash.

---

## 7. TypeScript target is ES2017 — no BigInt literals

**The bite.** `tsconfig.json` sets `"target": "ES2017"`. The `100_000_000n` BigInt literal syntax was added in ES2020. Using it compiles in dev (because tsc is lenient) but the bundle output includes the literal verbatim, which crashes in environments that don't support it. This bit the sibling on ADA formatting (lovelace amounts).

**The fix.** Never use the `n` BigInt literal suffix. If you need to handle large numbers (lovelace amounts, voting power, asset quantities), the conventions:

```ts
// DO — Koios returns string-encoded amounts. Use Number() for display,
// keep strings for round-tripping into DB or API responses.
const lovelace: string = "207116800428";  // from Koios account_info
const ada = Number(lovelace) / 1_000_000;
return ada.toFixed(2);

// DO — for arithmetic that needs precision beyond Number's 53-bit mantissa,
// use the BigInt() constructor function, not literals.
const total = BigInt(amountA) + BigInt(amountB);  // no `100n` literal

// DON'T
const min = 100_000_000n;                    // ES2020 syntax, target is ES2017
const total = BigInt("123") + 1n;            // mixing types, plus the literal
```

The sibling's `formatAda()` in `src/lib/koios.ts` is the reference pattern.

**Smell test.** If you see a number suffixed with `n` in source, it's a bug. Use `BigInt(value)` instead.

---

## 8. D1 timestamps — use `timestamp_ms` and `unixepoch('subsec')`

**The bite.** SQLite has no native datetime type. Naive Drizzle setups store dates as ISO strings or seconds-since-epoch, and the mismatch between DB representation and JS `Date` becomes a debugging nightmare. The sibling settled on a specific pattern after the first round of weirdness.

**The fix.** Every timestamp column follows this exact shape:

```ts
import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

createdAt: integer("created_at", { mode: "timestamp_ms" })
  .notNull()
  .default(sql`(unixepoch('subsec') * 1000)`),
```

- `mode: "timestamp_ms"` — Drizzle marshals these as `Date` objects in JS, integers in SQLite.
- `unixepoch('subsec') * 1000` — SQLite's subsecond unix epoch in seconds, multiplied to milliseconds. Don't use plain `CURRENT_TIMESTAMP` (it returns a string).
- The `.notNull()` is non-negotiable for created_at / updated_at columns.

**Don't** use `text` columns for dates. **Don't** use `mode: "timestamp"` (seconds — easy to get wrong). **Don't** use `Date.now()` as a default in JS — it's evaluated when the module loads, not when the row is inserted.

For `updatedAt`, set it explicitly in your UPDATE call:

```ts
await db.update(table)
  .set({ ...changes, updatedAt: new Date() })
  .where(...);
```

D1 doesn't have triggers we'd want to depend on.

---

## 9. Mock `getCloudflareContext` in tests

**The bite.** Anything that touches a binding or secret calls `getCloudflareContext()`. In Vitest's node environment, that function isn't available — the test crashes with a confusing import-time error.

**The fix.** Mock the module at the top of every test file that imports anything from `src/lib` (since most lib modules transitively use it):

```ts
import { describe, expect, it, vi } from "vitest";

// Stub the Cloudflare context module BEFORE importing the module under test.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      AUTH_SESSION_SECRET: "test-secret-do-not-use-in-prod",
      // ...add any other env vars your code reads
    },
  }),
}));

// Now import — the mock is in place.
import { signSession, verifySession } from "./session";
```

The mock must come **before** the import of the module under test. ES modules hoist imports, but `vi.mock` is hoisted further by Vitest's transformer specifically to support this.

For test data, use obviously-fake values (`test-secret-do-not-use-in-prod`, not real production secrets).

**Don't** spin up a real Wrangler dev server for unit tests — slow and flaky. The tests should mock at the function boundary and cover pure logic.

---

## 10. Schema ingestion / external data — normalise on the import edge

**The bite.** External data (whether from a JSON file, a webhook, or a partner API) tends to drift. Field names move (`hydra_id` was at `_meta.proposal_id` in older schemas, then at `source.hydra_id` in newer). Code that reads the data from many places starts handling all the variants, and the conditional logic spreads everywhere.

**The fix.** Normalise on the import edge — at the single function that ingests external data, hoist all variant shapes into one canonical form, then store that. Every reader downstream sees one shape.

The sibling's pattern in `src/app/api/proposals/import/route.ts`:

```ts
// Hoist _meta.proposal_id → source.hydra_id so the rest of the app reads
// a single canonical path (raw_payload.source.hydra_id) regardless of which
// shape the extractor produced.
const metaHydraId = p._meta?.proposal_id ?? null;
const sourceHydraId = p.source?.hydra_id ?? null;
const hydraId = metaHydraId ?? sourceHydraId ?? null;
const sourceWithHydra = { ...(p.source ?? {}), hydra_id: hydraId };
```

For the Campaign Leaderboard, this applies to:
- The Bounty webhook receiver (`/api/webhooks/bounty`) — normalise field shapes once on entry.
- The Dub webhook receiver (`/api/webhooks/dub`) — same.
- The X / YouTube OAuth payload handlers — when you fetch tweet or comment data, store the normalised shape, not the raw API response, in `submissions.oauth_payload`.
- Any partner API integration added later.

**Don't** scatter `if (data.fieldA ?? data.fieldB ?? data.fieldC)` across the codebase. **Do** decide on the canonical shape early, normalise once at the edge, and only read the canonical shape elsewhere.

---

## 11. Web Crypto, not Node crypto

**The bite.** Cloudflare Workers run on the Web Crypto API (`crypto.subtle`), not Node's `crypto` module. Code from Node tutorials uses `import crypto from "node:crypto"` and calls `crypto.createHmac(...)`, which compiles but crashes at runtime on Workers.

**The fix.** Use Web Crypto for everything. The sibling's `src/lib/session.ts` is the reference pattern — HMAC-SHA256 via `crypto.subtle.importKey` + `crypto.subtle.sign` + `crypto.subtle.verify`. All async, all returns ArrayBuffers, all base64-url-encoded for cookies/headers.

```ts
// DO
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);
const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));

// DON'T
import crypto from "node:crypto";
const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
// ↑ crashes on Workers
```

`@noble/hashes` is fine — it's pure JS and Workers-compatible. The sibling uses `blake2b` from there for Cardano credential hashing.

**Don't** use `Buffer` casually either. It exists in Workers thanks to the `nodejs_compat` flag, but base64-url-encoding via `btoa`/`atob` + replacement is the standard pattern. The sibling has helpers `b64url()` and `b64urlDecode()` in `session.ts`.

---

## 12. Cardano facade — never call Koios or Blockfrost directly

**The bite.** If verifiers (or any other module) import `koios.ts` or `blockfrost.ts` directly, the Koios-first-Blockfrost-fallback strategy isn't enforced. The first time Koios has an outage, half the verifiers fail and you have to find every call site.

**The fix.** Verifiers, page loaders, and admin tools call only `src/lib/cardano/index.ts`. That facade is the only file that imports from `./koios` and `./blockfrost`. The provider modules export the same surface (same function names, same return types defined in `./types.ts`), differing only in implementation.

```ts
// DO — in src/lib/verification/delegation.ts
import { getAccountInfo } from "@/lib/cardano";

// DON'T — in src/lib/verification/delegation.ts
import { getAccountInfo } from "@/lib/cardano/koios";   // ✗ bypasses fallback
```

Adding a third provider later (Maestro, self-hosted Koios) is a one-file change inside the facade. Worth the discipline.

---

## 13. KV caching — cheap calls, cheap caches, beware the writes

**The bite.** Cloudflare KV's free tier has 1,000 writes per day (and 100,000 on the $5/mo plan). The sibling once cached every individual proposal page render and burned through the daily write limit in a few hours. KV reads are abundant; writes are not.

**The fix.** Cache aggressively, write sparingly.
- Read-heavy data (DRep info, proposal abstracts, leaderboard top-100) → cache in KV with TTLs measured in minutes to hours.
- The `cached<T>()` helper in `src/lib/cardano/koios.ts` is the reference pattern: read first, fetch on miss, write once with TTL.
- Don't write to KV on every page request. Don't write per-user state to KV when the database is right there.
- For high-write transient state (rate limit counters, nonces) the TTL handles cleanup — but check the math: 1 nonce per signin × 100 users/day = 100 writes/day, fine. 1 cache write per page view × 10,000 views/day = oversubscribed even on paid.

Leaderboard cache pattern: write the top-100 to KV with a 30s TTL, regenerate on miss. Edge cache (browser + Cloudflare) on top of that absorbs viral spikes. The write rate is at most once per 30 seconds = 2,880/day, comfortable on the paid plan.

**Don't** cache user-specific data in KV keyed by user ID without thinking about the write multiplier. The leaderboard cache is one global key, not per-user.

---

## 14. Hydration mismatches — server-rendered timestamps will burn you

**The bite.** A server-rendered timestamp uses the server's locale and timezone. The client then hydrates with the user's locale and timezone. React detects the mismatch and either re-renders (slow flash) or throws a hydration error in dev.

**The fix.** Render an SSR-safe placeholder, swap to the localised version in an effect. The sibling's `src/components/local-time.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

export function LocalTime({ iso }: { iso: string }) {
  // SSR shows the raw ISO (first 16 chars, T→space) — deterministic.
  const [text, setText] = useState(iso.slice(0, 16).replace("T", " "));
  useEffect(() => {
    try {
      setText(new Date(iso).toLocaleString());
    } catch {
      // keep the ISO fallback
    }
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
```

Port this verbatim and use it for every displayed timestamp.

The same principle applies to anything locale-dependent: number formatting, currency symbols, weekday names. SSR a deterministic version, swap in an effect.

**Don't** call `new Date().toLocaleString()` directly inside a server or client component's render — hydration error guaranteed.

---

## 15. `useCardano` is a hook — don't read it during render of a server-imported component

**The bite.** `useCardano` returns wallet connection state. That state lives on `window.cardano`, which is undefined during SSR. Calling the hook inside a component that gets server-rendered crashes — even if the component is `"use client"`.

**The fix.** The "client component" boundary in App Router does **not** mean "this won't be rendered on the server". It means "this will also be rendered on the client". Server components still call client component renders to produce HTML.

Two patterns:

```tsx
// Pattern A: dynamic import with ssr: false (wallet-button.tsx)
// The outer file is import-able from server components; the inner file
// is only evaluated in the browser.
const Inner = dynamic(() => import("./wallet-inner"), { ssr: false });
export function WalletButton() {
  return <Inner />;
}

// Pattern B: mount gate (wallet-gate-inner.tsx)
"use client";
import { useEffect, useState } from "react";
export default function Gate({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}
```

Use Pattern A for the wallet UI itself (the button). Use Pattern B for any feature that conditionally shows based on connection state but doesn't need the wallet at first render.

**Don't** assume `"use client"` alone is enough. It isn't.

---

## 16. Drizzle migrations — the journal matters

**The bite.** `drizzle/migrations/meta/_journal.json` is the migration index. Drizzle-kit maintains it automatically. If you hand-write a SQL migration (e.g. for a one-off data backfill), you must add a corresponding journal entry — and that means copying the previous snapshot file. Get the index wrong and `wrangler d1 migrations apply` either skips your migration or errors out.

**The fix.** Standard flow:

```bash
# After editing src/db/schema.ts
npm run db:generate -- --name=add_campaign_status_column

# Apply locally first
npm run db:migrate:local

# Test the changes via `next dev`

# Apply to production
npm run db:migrate:remote
```

For hand-written SQL (rare — only when drizzle-kit can't express what you need):

1. Create the next-numbered `.sql` file under `drizzle/migrations/`.
2. Add an entry to `meta/_journal.json` with the correct `idx` (next integer), `version` (matches existing), `when` (current Unix ms), `tag` (matches the filename), `breakpoints` (`true`).
3. Copy the previous snapshot file (e.g. `0003_snapshot.json` → `0004_snapshot.json`) — same content, just renamed so the journal points to a valid file. Drizzle-kit checks the snapshot exists; it doesn't re-read its contents for hand-written migrations.

**Don't** hand-edit the journal without copying a snapshot. **Don't** delete a migration that's already been applied to production (use a new "down" migration instead).

---

## 17. Subtle defaults — request user-agent, accept headers, error swallowing

**The bite.** External APIs (Koios, CoinGecko, Hydra, Dub) sometimes reject anonymous requests or return different shapes based on `Accept` headers. The sibling found bugs where Koios returned a slightly different schema based on `Accept: */*` vs `Accept: application/json`.

**The fix.** Every outbound `fetch()` includes a deliberate user-agent and accept header. The pattern from `src/lib/koios.ts`:

```ts
const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "campaign-leaderboard/0.1 (+https://campaign.learncardano.io)",
  },
  body: JSON.stringify(body),
});
```

Three reasons:
1. Some APIs (like CoinGecko free tier) rate-limit aggressively without a real UA.
2. Identifying yourself helps partners diagnose your traffic in their logs (good will).
3. Explicit `accept` headers prevent silent schema drift.

**Don't** swallow fetch errors with bare `catch {}`. Log them with the module prefix:

```ts
} catch (e) {
  console.warn("[cardano:koios] account_info failed for", stakeAddress, e);
  return null;
}
```

The caller decides whether `null` means "fall back" or "fail closed".

---

## 18. The Cloudflare adapter regenerates types — don't commit the artifact

**The bite.** `npm run cf-typegen` generates `cloudflare-env.d.ts` from `wrangler.jsonc`. That file is huge (hundreds of KB) and changes every time bindings change. Committing it pollutes diffs and creates merge conflicts.

**The fix.** Already handled in `.gitignore`:

```
cloudflare-env.d.ts
```

Run `npm run cf-typegen` after editing `wrangler.jsonc` (adding bindings, changing var names) so your local TypeScript sees the new types. Don't commit the output.

**Don't** delete the line from `.gitignore` "to share types with the team" — every dev generates their own from the same `wrangler.jsonc` source.

---

## 19. Idempotency — every webhook, every external trigger

**The bite.** Webhooks retry. APIs occasionally deliver twice. Users click "submit" twice. If your handler isn't idempotent, you get double-credited points, duplicate submissions, double-counted clicks.

**The fix.** Idempotency keys built into the data model:

- `submissions(userId, taskId, txHash)` — UNIQUE index. Same tx for same task can't be re-submitted.
- `partnerPayoutBatches.txHash` — UNIQUE when not null. Same payout tx can't be recorded twice.
- `pointsLedger` — append-only with a `submissionId` reference. To roll back, insert a negative-delta row, never UPDATE an existing one.
- Webhook receivers — derive a deterministic ID from the payload (`bountyId`, `tweetId`, `clickEventId`) and dedupe on insert with `INSERT OR IGNORE` or a check-first-then-insert in a transaction.

For external webhooks (Bounty, Dub), include an HMAC signature check on every request:

```ts
const signature = req.headers.get("x-signature");
const computed = await hmacSha256(env.BOUNTY_WEBHOOK_HMAC_SECRET, await req.text());
if (signature !== computed) return new Response("forbidden", { status: 403 });
```

**Don't** trust webhook payloads without HMAC. **Don't** UPDATE points balances directly — always ledger inserts.

---

## 20. Logging and privacy — stake addresses are public, survey data is not

**The bite.** Stake addresses on Cardano are public on-chain. Logging them in full is fine for admin audit logs. **However**, the onboarding survey collects PII (age bracket, country, experience level). Logging that PII to console — even at warn or error level — risks leaking it through Cloudflare Observability or whatever log aggregator gets added later.

**The fix.** Two logging tiers.

For user-facing or general logging: truncate stake addresses, never include survey fields.

```ts
console.log("[submission] verified", { user: stake.slice(0, 12) + "…" + stake.slice(-6), taskId });
```

For admin audit logs: full stake addresses are fine, but survey fields stay in D1, never in logs.

```ts
await logChange({
  userId: adminStake,
  entityType: "submission",
  entityId: submissionId,
  field: "status",
  oldValue: "pending",
  newValue: "verified",
});
```

**Don't** `console.log(user)` where `user` is the full users row — that includes ageBracket, country, etc. Pick fields explicitly.

---

## 21. The "this should work" trap

When you encounter behaviour that contradicts your training data, the default reaction is "this should work, let me try a variation". For each item in this document, that reaction has already been had, and the variations have already failed. **The patterns described here are end-states of debugging sessions, not first guesses.**

If you find yourself thinking any of:
- "But `revalidatePath` is the standard Next pattern..."
- "But `cookies()` doesn't need `await` in my training data..."
- "But `process.env` is the universal way to read env vars..."
- "But this verifier library should just work without a fallback..."

— that is the smell. Stop. Re-read the relevant section above. Use the documented pattern.

---

## When you hit a NEW gotcha

This document is a living artefact. When something bites in development that isn't covered here, **add it**. Format:

```markdown
## N. Short imperative title

**The bite.** What goes wrong and how it manifests.

**The fix.** What to do instead, ideally with a code reference to the sibling repo.

**Don't try to** … (the specific tempting-but-wrong move).

**Smell test.** A one-line check that flags the bug at code-review time.
```

Add an entry every time you debug something for more than 30 minutes. Future you (or the next agent) will thank you.
