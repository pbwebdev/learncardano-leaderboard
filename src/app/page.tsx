import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { CONTENT_CREATORS } from "@/data/creators";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [stakeAddress, featured] = await Promise.all([
    getCurrentStakeAddressOrNull(),
    getDb()
      .select({ id: projects.id, name: projects.name, category: projects.category, logoR2Key: projects.logoR2Key })
      .from(projects)
      .where(and(eq(projects.status, "active"), eq(projects.featured, true)))
      .orderBy(asc(projects.displayOrder), asc(projects.name))
      .limit(12),
  ]);
  const signedIn = !!stakeAddress;

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 md:px-8 md:py-20 xl:px-0">
      <section className="max-w-3xl">
        <span className="pretitle">Cardano Quest Hub</span>
        <h1 className="mt-3 text-[color:var(--fg-heading)] font-bold tracking-tight">
          Earn ADA rewards across partnered Cardano projects
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-[color:var(--fg-muted)] sm:text-lg xl:text-xl">
          Complete on-chain and social tasks, climb a public leaderboard, and
          collect token rewards — every payout verified on-chain. Sign in with
          any CIP-30 wallet, no email, no password.
        </p>

        {signedIn ? (
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <Link href="/me" className="btn-primary">Go to my dashboard</Link>
            <Link href="/leaderboard" className="btn-secondary">View leaderboard</Link>
            <span className="font-mono text-xs text-[color:var(--fg-faint)] break-all sm:break-normal">
              signed in as {stakeAddress.slice(0, 12)}…{stakeAddress.slice(-6)}
            </span>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="btn-primary cursor-default opacity-90 select-none">Connect wallet ↗</span>
            <span className="text-sm text-[color:var(--fg-faint)]">
              Use the <strong>Connect wallet</strong> button in the header.
            </span>
          </div>
        )}
      </section>

      {!signedIn && (
        <section className="mt-16 grid gap-8 sm:mt-20 md:grid-cols-3">
          <Feature
            title="Sign in with your wallet"
            body="Any CIP-30 Cardano wallet works — Eternl, Lace, Nami, Typhon, and more. Your stake address is your identity; no password, no email, no fees."
          />
          <Feature
            title="Complete partnered tasks"
            body="Delegate to a pool, swap on a DEX, share a campaign post — each verified task adds points to your public ranking."
          />
          <Feature
            title="Get paid on-chain"
            body="Partner rewards land in the same wallet you signed in with. Every payout tx is verified on-chain before the leaderboard marks it settled."
          />
        </section>
      )}

      {/* ── Partnered content creators ────────────────────────────────── */}
      <section className="mt-20 sm:mt-24">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <span className="pretitle">Partnered creators</span>
            <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
              Making content for the platform
            </h2>
          </div>
          <p className="text-sm text-[color:var(--fg-muted)]">
            From the Cardano Content Creators Consortium.
          </p>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CONTENT_CREATORS.map((c) => (
            <li key={c.handle}>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-center transition-colors hover:border-[color:var(--accent-primary)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--bg-elevated)] text-[color:var(--fg-muted)]">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </span>
                <span className="font-mono text-xs text-[color:var(--fg)] break-all">
                  @{c.displayName ?? c.handle}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Featured projects strip ──────────────────────────────────── */}
      {featured.length > 0 && (
        <section className="mt-16 sm:mt-20">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <span className="pretitle">Featured projects</span>
              <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                Cardano dApps you can earn from today
              </h2>
            </div>
            <Link
              href="/projects"
              className="text-sm text-[color:var(--accent-info)] hover:text-[color:var(--accent-info-strong)] underline"
            >
              See all projects →
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {featured.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="group flex flex-col items-center gap-2 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-center transition-colors hover:border-[color:var(--accent-primary)]"
                >
                  <ProjectLogoMark name={p.name} category={p.category} hasLogo={!!p.logoR2Key} />
                  <span className="text-xs font-semibold text-[color:var(--fg)]">
                    {p.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-[color:var(--fg-muted)]">
                    {p.category}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-16 sm:mt-24">
        <div className="cta-banner flex flex-col items-stretch gap-5 p-6 sm:p-8 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6">
          <div>
            <h2 className="text-xl font-semibold sm:text-2xl lg:text-3xl">Run a Cardano project?</h2>
            <p className="mt-2 text-sm opacity-90 lg:text-base">
              Partner with Learn Cardano to launch a campaign — verified tasks, on-chain rewards, transparent payouts.
            </p>
          </div>
          {/*
            Indigo-700 hardcoded for the text colour — we need AA contrast
            against the white button background, and var(--accent-primary)
            is indigo-500 (#6366f1) in dark mode which falls below 4.5:1
            on white. indigo-700 (#4338ca) sits at ~8:1 across both modes.
          */}
          <Link
            href="/partners"
            className="inline-flex items-center justify-center rounded-[--radius-md] bg-white px-6 py-3 font-semibold text-indigo-700 hover:bg-indigo-50 w-full md:w-auto"
          >
            See what we need
          </Link>
        </div>
      </section>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="icon-tile">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-[color:var(--fg-heading)]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--fg-muted)]">{body}</p>
    </div>
  );
}

/**
 * Grayscale logo placeholder for the featured-projects strip.
 *
 * If the project has uploaded a logo (logo_r2_key set), we'd ideally
 * render it via a signed R2 URL. That plumbing isn't built yet — the
 * column is reserved for Phase 5+ logo uploads. For now every featured
 * project gets a circular initial-mark sized to match an eventual
 * 40×40 logo, with a per-category accent on the ring so the strip
 * doesn't feel monotone.
 *
 * The marks render at grayscale opacity by default and warm up to
 * full accent on hover, which is the "grey scale logos" visual Peter
 * asked for.
 */
function ProjectLogoMark({ name, category, hasLogo: _hasLogo }: { name: string; category: string; hasLogo: boolean }) {
  const initial = name.trim().charAt(0).toUpperCase() || "•";
  const ring =
    category === "defi" ? "ring-emerald-400/40"
    : category === "nft" ? "ring-pink-400/40"
    : category === "governance" ? "ring-amber-400/40"
    : category === "education" ? "ring-sky-400/40"
    : category === "gaming" ? "ring-fuchsia-400/40"
    : "ring-indigo-400/40";
  return (
    <span
      aria-hidden="true"
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--bg-elevated)] text-base font-bold text-[color:var(--fg-muted)] ring-2 ${ring} grayscale opacity-80 transition group-hover:grayscale-0 group-hover:opacity-100`}
    >
      {initial}
    </span>
  );
}
