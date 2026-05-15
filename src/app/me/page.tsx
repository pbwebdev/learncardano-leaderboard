import { redirect } from "next/navigation";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setProfileVisibility } from "./actions";
import { SaveForm } from "@/components/save-form";

export const dynamic = "force-dynamic";

export default async function MyDashboardPage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();
  if (!stakeAddress) {
    redirect("/");
  }

  const rows = await getDb().select().from(users).where(eq(users.stakeAddress, stakeAddress)).limit(1);
  const user = rows[0];

  if (user && !user.onboardingCompleted) {
    redirect("/me/onboarding");
  }

  const visibility = user?.profileVisibility ?? "public";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">My dashboard</h1>
      <p className="mt-2 font-mono text-xs text-[color:var(--fg-muted)]">
        {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
      </p>

      <section className="mt-8 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
        <h2 className="text-lg font-semibold">Points</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          Phase 1 will land project tasks, submissions, and the points ledger.
          Your current balance will appear here.
        </p>
        <p className="mt-4 font-mono text-2xl text-[color:var(--fg)]">— pts</p>
      </section>

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
        <h2 className="text-lg font-semibold">Recent submissions</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          No submissions yet. When task verification ships in Phase 1 your
          history will appear here.
        </p>
      </section>

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
        <h2 className="text-lg font-semibold">Profile visibility</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          When public, your stake address and points appear on the leaderboard
          and on a public profile at <code>/u/&lt;stake-address&gt;</code>.
          When private, your profile returns 404 and you do not appear on the
          leaderboard. Onboarding survey answers are never shown publicly.
        </p>
        <SaveForm action={setProfileVisibility} className="mt-4 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="visibility" value="public" defaultChecked={visibility === "public"} />
            <span>Public — show me on the leaderboard</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="visibility" value="private" defaultChecked={visibility === "private"} />
            <span>Private — hide my profile and leaderboard entry</span>
          </label>
          <button
            type="submit"
            className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[color:var(--accent-primary-strong)]"
          >
            Save visibility
          </button>
        </SaveForm>
      </section>
    </main>
  );
}
