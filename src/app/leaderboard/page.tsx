import Link from "next/link";
import { getPointsLeaderboard } from "@/lib/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors across partnered Cardano projects, ranked by verified points.",
};

export default async function LeaderboardPage() {
  const rows = await getPointsLeaderboard(100);
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mt-2 text-sm text-[color:var(--fg-muted)]">Top 100 public profiles by verified points.</p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 text-sm">
          <p>No verified submissions yet. <Link href="/projects" className="underline">Browse projects</Link> to get started.</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
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
      )}
    </main>
  );
}
