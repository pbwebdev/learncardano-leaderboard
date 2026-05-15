import Link from "next/link";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();
  const signedIn = !!stakeAddress;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-[color:var(--fg-heading)]">
        Learn Cardano Leaderboard
      </h1>
      <p className="mt-4 text-lg text-[color:var(--fg-muted)]">
        Complete on-chain and social tasks across partnered Cardano projects.
        Earn points, token rewards, and a place on the public leaderboard —
        with every payout verified on-chain.
      </p>

      {signedIn ? (
        <div className="mt-10 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
          <p className="text-sm text-[color:var(--fg-muted)]">
            Welcome back.
          </p>
          <p className="mt-1 font-mono text-xs text-[color:var(--fg)]">
            {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/me"
              className="rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[color:var(--accent-primary-strong)]"
            >
              Go to my dashboard
            </Link>
            <Link
              href="/leaderboard"
              className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-4 py-2 text-sm hover:bg-[color:var(--bg-elevated)]"
            >
              View leaderboard
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-10 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 font-sans">
          <h2 className="text-base font-semibold text-[color:var(--fg-heading)]">
            Connect your wallet from the header to get started
          </h2>
          <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
            Sign in with any CIP-30 Cardano wallet (Eternl, Lace, Nami, Typhon,
            and more). No password, no email — your stake address is your
            identity. Points and rewards are tied to that stake key.
          </p>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-[color:var(--fg-muted)]">
            <li>Click <strong>Connect wallet</strong> in the header.</li>
            <li>Approve the connection in your wallet.</li>
            <li>Sign the one-time login message — no transaction, no fees.</li>
          </ol>
        </div>
      )}
    </main>
  );
}
