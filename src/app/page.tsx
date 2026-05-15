import Link from "next/link";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();
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

      <section className="mt-16 sm:mt-24">
        <div className="cta-banner flex flex-col items-stretch gap-5 p-6 sm:p-8 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6">
          <div>
            <h2 className="text-xl font-semibold sm:text-2xl lg:text-3xl">Run a Cardano project?</h2>
            <p className="mt-2 text-sm opacity-90 lg:text-base">
              Partner with Learn Cardano to launch a campaign — verified tasks, on-chain rewards, transparent payouts.
            </p>
          </div>
          <a
            href="https://learncardano.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-[--radius-md] bg-white px-6 py-3 font-semibold text-[color:var(--accent-primary)] hover:opacity-90 w-full md:w-auto"
          >
            Get in touch
          </a>
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
