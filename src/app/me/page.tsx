import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { projects, submissions, tasks, users } from "@/db/schema";
import { getPointsFor } from "@/lib/points";
import { disconnectX, disconnectYoutube, setProfileVisibility } from "./actions";
import { SaveForm } from "@/components/save-form";
import { LocalTime } from "@/components/local-time";
import { CopyRefCode } from "@/components/copy-ref-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MyDashboardPage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();
  if (!stakeAddress) {
    redirect("/");
  }

  const db = getDb();
  const userRows = await db.select().from(users).where(eq(users.stakeAddress, stakeAddress)).limit(1);
  const user = userRows[0];
  if (user && !user.onboardingCompleted) {
    redirect("/me/onboarding");
  }
  const visibility = user?.profileVisibility ?? "public";

  const [points, recent, referralCountRow] = await Promise.all([
    getPointsFor(stakeAddress),
    db
      .select({
        id: submissions.id,
        status: submissions.status,
        submittedAt: submissions.submittedAt,
        verifiedAt: submissions.verifiedAt,
        taskTitle: tasks.title,
        taskPoints: tasks.points,
        projectName: projects.name,
        projectId: projects.id,
      })
      .from(submissions)
      .innerJoin(tasks, eq(tasks.id, submissions.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(submissions.userId, stakeAddress))
      .orderBy(desc(submissions.submittedAt))
      .limit(10),
    user?.refCode
      ? db.select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.invitedByRefCode, user.refCode))
      : Promise.resolve([{ n: 0 }] as Array<{ n: number }>),
  ]);
  const referralCount = Number(referralCountRow[0]?.n ?? 0);
  const xLinked = !!user?.xHandle;
  const ytLinked = !!user?.youtubeChannelId;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-bold tracking-tight">My dashboard</h1>
      <p className="mt-2 font-mono text-xs text-[color:var(--fg-muted)] break-all">
        {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
      </p>

      <section className="mt-8 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
        <h2 className="text-lg font-semibold">Points</h2>
        <p className="mt-4 font-mono text-3xl text-[color:var(--fg)]">{points} <span className="text-base text-[color:var(--fg-muted)]">pts</span></p>
        {visibility === "public" && (
          <p className="mt-2 text-xs text-[color:var(--fg-muted)] break-all">
            Your public profile is at <Link className="underline" href={`/u/${stakeAddress}`}>/u/{stakeAddress.slice(0, 12)}…</Link>
          </p>
        )}
      </section>

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
        <h2 className="text-lg font-semibold">Recent submissions</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-[color:var(--fg-muted)]">No submissions yet. <Link href="/projects" className="underline">Browse projects</Link> to get started.</p>
        ) : (
          <ul className="mt-3 space-y-3 sm:space-y-2 text-sm">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 border-b border-[color:var(--rule)] pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2 sm:border-b-0 sm:pb-0"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusPill status={r.status} />
                  <Link href={`/projects/${r.projectId}`} className="font-medium underline">{r.projectName}</Link>
                </div>
                <span className="hidden sm:inline text-[color:var(--fg-muted)]">·</span>
                <span className="text-[color:var(--fg-muted)] sm:text-[color:var(--fg)]">{r.taskTitle}</span>
                <span className="text-xs text-[color:var(--fg-muted)] sm:ml-auto">
                  <LocalTime iso={r.submittedAt.toISOString()} />
                  {r.status === "verified" && r.taskPoints !== 0 && (
                    <span className="ml-2">+{r.taskPoints} pts</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user?.refCode && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
          <h2 className="text-lg font-semibold">Your referral code</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <CopyRefCode code={user.refCode} />
            <span className="text-sm text-[color:var(--fg-muted)]">
              {referralCount} {referralCount === 1 ? "person" : "people"} signed up with your code
            </span>
          </div>
          <p className="mt-3 text-xs text-[color:var(--fg-muted)]">
            Share this code with friends. When they enter it during onboarding, we record the link.
            (Referral bonuses are still being designed — Peter will announce the formula before launch.)
          </p>
        </section>
      )}

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
        <h2 className="text-lg font-semibold">Linked accounts</h2>
        <p className="mt-1 text-xs text-[color:var(--fg-muted)]">
          Linking an account lets the verifier confirm tweets and YouTube
          comments you submit. Disconnect any time — your existing verified
          submissions stay.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex items-center gap-3 flex-wrap">
            <span className="w-20 shrink-0 text-[color:var(--fg-muted)]">X</span>
            {xLinked ? (
              <>
                <span className="rounded-full bg-[color:var(--status-green-bg)] px-2 py-0.5 text-xs text-[color:var(--status-green)]">
                  ● Connected
                </span>
                <span className="font-mono">@{user!.xHandle}</span>
                <SaveForm action={disconnectX} className="inline">
                  <button
                    type="submit"
                    className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-2 py-1 text-xs hover:bg-[color:var(--bg-elevated)]"
                  >
                    Disconnect
                  </button>
                </SaveForm>
              </>
            ) : (
              <a href="/api/oauth/x/start" className="underline tap-target inline-flex items-center">Connect X</a>
            )}
          </li>
          <li className="flex items-center gap-3 flex-wrap">
            <span className="w-20 shrink-0 text-[color:var(--fg-muted)]">YouTube</span>
            {ytLinked ? (
              <>
                <span className="rounded-full bg-[color:var(--status-green-bg)] px-2 py-0.5 text-xs text-[color:var(--status-green)]">
                  ● Connected
                </span>
                <span className="break-all">{user!.youtubeChannelTitle ?? user!.youtubeChannelId}</span>
                <SaveForm action={disconnectYoutube} className="inline">
                  <button
                    type="submit"
                    className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-2 py-1 text-xs hover:bg-[color:var(--bg-elevated)]"
                  >
                    Disconnect
                  </button>
                </SaveForm>
              </>
            ) : (
              <a href="/api/oauth/youtube/start" className="underline tap-target inline-flex items-center">Connect YouTube</a>
            )}
          </li>
        </ul>
      </section>

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
        <h2 className="text-lg font-semibold">Profile visibility</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          When public, your stake address and points appear on the leaderboard
          and on a public profile at <code>/u/&lt;stake-address&gt;</code>.
          When private, your profile returns 404 and you do not appear on the
          leaderboard. Onboarding survey answers are never shown publicly.
        </p>
        <SaveForm action={setProfileVisibility} className="mt-4 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-3 tap-target cursor-pointer">
            <input type="radio" name="visibility" value="public" defaultChecked={visibility === "public"} />
            <span>Public — show me on the leaderboard</span>
          </label>
          <label className="flex items-center gap-3 tap-target cursor-pointer">
            <input type="radio" name="visibility" value="private" defaultChecked={visibility === "private"} />
            <span>Private — hide my profile and leaderboard entry</span>
          </label>
          <button
            type="submit"
            className="mt-2 w-full sm:self-start sm:w-auto rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[color:var(--accent-primary-strong)]"
          >
            Save visibility
          </button>
        </SaveForm>
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const colour = {
    pending: "bg-yellow-200 text-yellow-900",
    verified: "bg-green-200 text-green-900",
    rejected: "bg-red-200 text-red-900",
    verifying: "bg-blue-200 text-blue-900",
    paid: "bg-purple-200 text-purple-900",
    reward_verified: "bg-emerald-200 text-emerald-900",
  }[status] ?? "bg-gray-200 text-gray-900";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>{status}</span>;
}
