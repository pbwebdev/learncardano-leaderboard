import Link from "next/link";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors across partnered Cardano projects, ranked by verified points.",
};

export default async function LeaderboardPage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mt-3 text-sm text-[color:var(--fg-muted)]">
        Public ranking of every user with verified task completions across
        partnered Cardano projects.
      </p>

      <div className="mt-10 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 font-sans">
        <h2 className="text-base font-semibold">Coming in Phase 1</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          The leaderboard turns on when the first batch of partnered project
          tasks lands. Until then, browse the upcoming projects or set up your
          profile.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/projects"
            className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-3 py-1.5 hover:bg-[color:var(--surface)]"
          >
            See projects
          </Link>
          {stakeAddress && (
            <Link
              href="/me"
              className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-3 py-1.5 hover:bg-[color:var(--surface)]"
            >
              My dashboard
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
