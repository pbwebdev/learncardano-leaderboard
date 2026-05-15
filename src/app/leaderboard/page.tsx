import Link from "next/link";
import { getCachedLeaderboard } from "@/lib/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors across partnered Cardano projects, ranked by verified points.",
};

export default async function LeaderboardPage() {
  const rows = await getCachedLeaderboard(100);
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mt-2 text-sm text-[color:var(--fg-muted)]">Top 100 public profiles by verified points.</p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 text-sm">
          <p>No verified submissions yet. <Link href="/projects" className="underline">Browse projects</Link> to get started.</p>
        </div>
      ) : (
        <>
          {/* Desktop / tablet — original table (md and up) */}
          <section className="mt-8 hidden md:block overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2 text-right">Points</th>
                  <th className="px-3 py-2 text-right">Verified</th>
                  <th className="px-3 py-2 text-right">Projects</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.stakeAddress} className="border-t border-[color:var(--rule)]">
                    <td className="px-3 py-2 font-mono">{r.rank}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/u/${r.stakeAddress}`} className="underline hover:text-[color:var(--accent-info)]">
                        {r.stakeAddress.slice(0, 14)}…{r.stakeAddress.slice(-6)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{r.totalPoints || "—"}</td>
                    <td className="px-3 py-2 text-right">{r.verifiedSubmissions || "—"}</td>
                    <td className="px-3 py-2 text-right">{r.projectsEngaged || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Mobile — card rows (below md). Big mono rank on the left, stake +
              the three stat numbers stacked on the right. */}
          <section className="mt-8 md:hidden flex flex-col gap-2" aria-label="Leaderboard">
            <div className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)] px-1">
              Top {rows.length}
            </div>
            <ol className="flex flex-col gap-2">
              {rows.map((r) => (
                <li
                  key={r.stakeAddress}
                  className="flex items-center gap-3 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
                >
                  <div className="font-mono text-2xl font-bold text-[color:var(--fg-heading)] tabular-nums w-10 text-right">
                    {r.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/u/${r.stakeAddress}`}
                      className="block font-mono text-xs underline hover:text-[color:var(--accent-info)] truncate"
                    >
                      {r.stakeAddress.slice(0, 14)}…{r.stakeAddress.slice(-6)}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[color:var(--fg-muted)]">
                      <span>
                        <span className="font-mono text-[color:var(--fg)] font-medium">{r.totalPoints || "—"}</span> pts
                      </span>
                      <span>
                        <span className="font-mono text-[color:var(--fg)] font-medium">{r.verifiedSubmissions || "—"}</span> verified
                      </span>
                      <span>
                        <span className="font-mono text-[color:var(--fg)] font-medium">{r.projectsEngaged || "—"}</span> projects
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
