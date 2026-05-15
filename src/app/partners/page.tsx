import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner with Learn Cardano Leaderboard",
  description:
    "Run a Cardano project? Get your users earning verified, on-chain rewards. Here's what we need to integrate and how to get in touch.",
};

const CONTACT_EMAIL = "peter@learncardano.io";
const X_HANDLE = "astroboysoup";
const OPEN_CALL_TWEET = "https://x.com/astroboysoup/status/2055418015802651103";

export default function PartnersPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16 md:py-20">
      <section>
        <span className="pretitle">Partners</span>
        <h1 className="mt-3 text-[color:var(--fg-heading)] font-bold tracking-tight">
          Run a Cardano project? Let your users earn for real on-chain interactions.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-[color:var(--fg-muted)] sm:text-lg">
          Learn Cardano Leaderboard is a public, wallet-gated leaderboard
          where users complete tasks across partnered Cardano dApps and earn
          points + token rewards. Every payout is verified on-chain before
          it lands on a user&apos;s profile.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-[color:var(--fg-muted)]">
          Plug your contract in once. We handle the rest: signup gating,
          task discovery, verification, anti-spam, leaderboard, payouts CSV.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold tracking-tight">What we verify today</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          <Bullet title="On-chain interactions">
            Pool delegation, DRep delegation, DRep registration, swap-style tx
            with strict redeemer/script-hash checks, asset purchase, governance
            votes. Cardano façade routes Koios → Blockfrost on failure.
          </Bullet>
          <Bullet title="Social proof">
            Tweet posted from a linked X account containing required hashtags
            and mentions. YouTube comment on a configured video from a linked
            channel.
          </Bullet>
          <Bullet title="Off-chain bounties">
            HMAC-verified webhooks from your bounty page on{" "}
            <a
              href="https://bounty-preview.learncardano.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Learn Cardano Bounties
            </a>
            . We accept the event, credit points, log audit.
          </Bullet>
          <Bullet title="Reward payouts">
            CSV export per project + date range, payment + stake addresses
            included. You record the payout tx hash; we verify it matches on
            the next cron tick.
          </Bullet>
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold tracking-tight">What we need from you</h2>
        <p className="mt-3 text-base text-[color:var(--fg-muted)]">
          For high-reward on-chain tasks, the more of these we have, the
          tighter the verification. Anything you can&apos;t share, leave
          blank — the verifier falls back to confirming the tx exists,
          is confirmed, and involved the user&apos;s wallet.
        </p>
        <ol className="mt-5 space-y-4">
          <Step
            n={1}
            title="Plutus script hash (56 hex chars)"
            body="The script your users interact with. If your dApp has multiple scripts (e.g. an order book + a settlement contract), tell us which one fires for the action you want rewarded."
          />
          <Step
            n={2}
            title="Redeemer tag"
            body="Pick one: spend, mint, cert, reward, vote, propose. Tells us what kind of action the user did at the script."
          />
          <Step
            n={3}
            title="Constructor index per action"
            body="The number inside the redeemer that distinguishes actions. e.g. ctor 0 = place order, ctor 1 = cancel order. Send the mapping for each action you'd like to reward."
          />
          <Step
            n={4}
            title="Mint policy ID + asset name (if applicable)"
            body="If the rewarded action mints a receipt token, LP token, or NFT, send us the policy ID (56 hex) and asset name (hex). We verify the mint happened in the tx."
            optional
          />
          <Step
            n={5}
            title="Reference script hash (if applicable)"
            body="If your contract is referenced from a long-lived UTxO (CIP-31), the ref-script hash. We verify the tx references it."
            optional
          />
          <Step
            n={6}
            title="Output datum hash (if pinned)"
            body="If the task should only count for a specific datum shape, send the blake2b-256 hash. We match against tx outputs."
            optional
          />
        </ol>
      </section>

      <section className="mt-12 rounded-[--radius-lg] border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <h2 className="text-lg font-semibold tracking-tight">Example: a DEX-style swap-order task</h2>
        <pre className="mt-4 overflow-x-auto rounded-[--radius-md] bg-[color:var(--bg-code)] p-4 text-xs leading-relaxed">
{`script hash:        ${"a".repeat(56)}   ← your contract
redeemer tag:       spend
ctor 0 = place order               ← we reward this
ctor 1 = cancel order              ← skip
ctor 2 = settle                    ← skip
mint policy:        ${"b".repeat(56)}   ← receipt NFT (optional)`}
        </pre>
        <p className="mt-3 text-sm text-[color:var(--fg-muted)]">
          That tells us: only count txs that spend your contract with
          redeemer constructor <code>0</code>, and bonus check that a
          receipt NFT was minted under the given policy.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold tracking-tight">Get in touch</h2>
        <p className="mt-3 text-base text-[color:var(--fg-muted)]">
          Three ways to reach us — pick whichever you prefer:
        </p>
        <ul className="mt-5 space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <div className="icon-tile shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div>
              <p className="font-semibold">Email</p>
              <p className="text-[color:var(--fg-muted)]">
                <a href={`mailto:${CONTACT_EMAIL}?subject=Leaderboard%20partnership`} className="underline font-mono">{CONTACT_EMAIL}</a>
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <div className="icon-tile shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </div>
            <div>
              <p className="font-semibold">X (Twitter) DM</p>
              <p className="text-[color:var(--fg-muted)]">
                <a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noopener noreferrer" className="underline">@{X_HANDLE}</a>
                {" · "}
                <a href={OPEN_CALL_TWEET} target="_blank" rel="noopener noreferrer" className="underline">reply to the open-call tweet</a>
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <div className="icon-tile shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div>
              <p className="font-semibold">Learn Cardano</p>
              <p className="text-[color:var(--fg-muted)]">
                <a href="https://learncardano.io" target="_blank" rel="noopener noreferrer" className="underline">learncardano.io</a>
              </p>
            </div>
          </li>
        </ul>
        <p className="mt-6 text-xs text-[color:var(--fg-muted)]">
          If you DM and don&apos;t hear back within a couple of days, tag
          @{X_HANDLE} under the open-call tweet — it surfaces faster.
        </p>
      </section>
    </main>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-[color:var(--fg-muted)]">{children}</p>
    </li>
  );
}

function Step({ n, title, body, optional }: { n: number; title: string; body: string; optional?: boolean }) {
  return (
    <li className="flex items-start gap-4">
      <div className="icon-tile shrink-0">
        <span className="font-mono font-bold">{n}</span>
      </div>
      <div>
        <p className="font-semibold">
          {title}{" "}
          {optional && (
            <span className="ml-1 rounded bg-[color:var(--bg-code)] px-1.5 py-0.5 text-xs font-normal text-[color:var(--fg-muted)]">
              optional
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-[color:var(--fg-muted)]">{body}</p>
      </div>
    </li>
  );
}
