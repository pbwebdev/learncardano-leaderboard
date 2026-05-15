import Link from "next/link";
import { getCachedLeaderboard, getLatestTasksAdded, getRankFor, type LeaderboardRow } from "@/lib/points";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { taskTypeLabelSuffix } from "@/lib/verification";
import { LeaderboardExpand } from "@/components/leaderboard-expand";
import { LeaderboardRankFooter } from "@/components/leaderboard-rank-footer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors across partnered Cardano projects, ranked by verified points.",
};

const VISIBLE_COUNT = 15;

/**
 * Tailwind class triple for a task-type chip, keyed off the suffix that
 * the admin form uses (`taskTypeLabelSuffix`). Three colour buckets:
 *   - manual review → amber (status-amber tokens)
 *   - on-chain      → indigo (accent-primary tokens, matches links)
 *   - social OAuth  → green (status-green tokens)
 *   - webhook-only / other → neutral
 */
function taskTypeChipClasses(taskType: string): string {
  const suffix = taskTypeLabelSuffix(taskType);
  if (suffix === " · manual review") {
    return "bg-[color:var(--status-amber-bg)] text-[color:var(--status-amber)]";
  }
  if (suffix === " · on-chain") {
    return "bg-[color:var(--accent-primary-soft)] text-[color:var(--accent-primary)]";
  }
  if (suffix === " · social OAuth") {
    return "bg-[color:var(--status-green-bg)] text-[color:var(--status-green)]";
  }
  return "bg-[color:var(--status-neutral-bg)] text-[color:var(--status-neutral)]";
}

function taskTypeChipLabel(taskType: string): string {
  const suffix = taskTypeLabelSuffix(taskType);
  if (suffix === " · manual review") return "manual review";
  if (suffix === " · on-chain") return "on-chain";
  if (suffix === " · social OAuth") return "social OAuth";
  if (suffix === " · webhook-only") return "webhook";
  return taskType;
}

export default async function LeaderboardPage() {
  const rows = await getCachedLeaderboard(100);
  const me = await getCurrentStakeAddressOrNull();

  const meInTop = me ? rows.find((r) => r.stakeAddress === me) ?? null : null;
  const meBelowTop = me && !meInTop ? await getRankFor(me) : null;

  const latestTasks = await getLatestTasksAdded(10);

  const visibleRows = rows.slice(0, VISIBLE_COUNT);
  const restRows = rows.slice(VISIBLE_COUNT);
  const restCount = restRows.length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
        Top 100 public profiles by verified points. Tap a row to view their profile.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 text-sm">
          <p>
            No verified submissions yet. <Link href="/projects" className="underline">Browse projects</Link> to get started.
          </p>
        </div>
      ) : (
        <LeaderboardExpand restCount={restCount}>
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
                {visibleRows.map((r) => (
                  <DesktopRow key={r.stakeAddress} r={r} isMe={!!me && r.stakeAddress === me} />
                ))}
                {restRows.map((r) => (
                  <DesktopRow
                    key={r.stakeAddress}
                    r={r}
                    isMe={!!me && r.stakeAddress === me}
                    rest
                  />
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
              {visibleRows.map((r) => (
                <MobileCard key={r.stakeAddress} r={r} isMe={!!me && r.stakeAddress === me} />
              ))}
              {restRows.map((r) => (
                <MobileCard
                  key={r.stakeAddress}
                  r={r}
                  isMe={!!me && r.stakeAddress === me}
                  rest
                />
              ))}
            </ol>
          </section>
        </LeaderboardExpand>
      )}

      {latestTasks.length > 0 && (
        <section className="mt-12 border-t border-[color:var(--rule)] pt-8" aria-label="Latest tasks added">
          <h2 className="text-xl font-semibold tracking-tight">Latest tasks added</h2>
          <p className="mt-1 text-sm text-[color:var(--fg-muted)]">
            New ways to earn points across partnered projects.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {latestTasks.map((t) => (
              <li
                key={t.taskId}
                className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/projects/${t.projectId}`}
                        className="text-xs font-medium text-[color:var(--fg-muted)] underline hover:text-[color:var(--accent-info)]"
                      >
                        {t.projectName}
                      </Link>
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${taskTypeChipClasses(
                          t.taskType,
                        )}`}
                      >
                        {taskTypeChipLabel(t.taskType)}
                      </span>
                    </div>
                    <Link
                      href={`/projects/${t.projectId}/tasks/${t.taskId}/submit`}
                      className="mt-1 block truncate text-sm font-medium text-[color:var(--fg)] hover:text-[color:var(--accent-info)]"
                    >
                      {t.taskTitle}
                    </Link>
                  </div>
                  <div className="font-mono text-sm text-[color:var(--fg)] sm:text-right">
                    {t.points} pts
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {meBelowTop && (
        <LeaderboardRankFooter
          rank={meBelowTop.rank}
          totalPoints={meBelowTop.totalPoints}
          verifiedSubmissions={meBelowTop.verifiedSubmissions}
          projectsEngaged={meBelowTop.projectsEngaged}
        />
      )}
    </main>
  );
}

function DesktopRow({ r, isMe, rest }: { r: LeaderboardRow; isMe: boolean; rest?: boolean }) {
  const baseBorder = isMe ? "border-l-4 border-l-[color:var(--accent-primary)]" : "";
  const baseBg = isMe ? "bg-[color:var(--bg-elevated)]" : "";
  return (
    <tr
      data-leaderboard-rest={rest ? "" : undefined}
      className={`border-t border-[color:var(--rule)] ${baseBorder} ${baseBg}`}
    >
      <td className="px-3 py-2 font-mono">{r.rank}</td>
      <td className="px-3 py-2 font-mono text-xs">
        <Link href={`/u/${r.stakeAddress}`} className="underline hover:text-[color:var(--accent-info)]">
          {r.stakeAddress.slice(0, 14)}…{r.stakeAddress.slice(-6)}
        </Link>
        {isMe && (
          <span className="ml-2 inline-block rounded bg-[color:var(--accent-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--accent-primary)]">
            you
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono">{r.totalPoints || "—"}</td>
      <td className="px-3 py-2 text-right">{r.verifiedSubmissions || "—"}</td>
      <td className="px-3 py-2 text-right">{r.projectsEngaged || "—"}</td>
    </tr>
  );
}

function MobileCard({ r, isMe, rest }: { r: LeaderboardRow; isMe: boolean; rest?: boolean }) {
  const meBorder = isMe ? "border-l-4 border-l-[color:var(--accent-primary)]" : "";
  const meBg = isMe ? "bg-[color:var(--bg-elevated)]" : "bg-[color:var(--surface)]";
  return (
    <li
      data-leaderboard-rest={rest ? "" : undefined}
      className={`flex items-center gap-3 rounded-[--radius-md] border border-[color:var(--border)] p-3 ${meBg} ${meBorder}`}
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
        {isMe && (
          <span className="mt-0.5 inline-block rounded bg-[color:var(--accent-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--accent-primary)]">
            you
          </span>
        )}
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
  );
}
