import Link from "next/link";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Projects",
  description: "Partnered Cardano projects with active tasks, on-chain rewards, and verified payouts.",
};

export default async function ProjectsPage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
      <p className="mt-3 text-sm text-[color:var(--fg-muted)]">
        Cardano projects we have partnered with, each running curated tasks
        you can complete for points and token rewards.
      </p>

      <div className="mt-10 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 font-sans">
        <h2 className="text-base font-semibold">Coming in Phase 1</h2>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          The project gallery turns on once we have onboarded the first wave of
          partners. If you run a Cardano project and want to participate, get in
          touch with{" "}
          <a
            href="https://learncardano.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--fg)] underline hover:text-[color:var(--accent-info)]"
          >
            Learn Cardano
          </a>.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            href="/leaderboard"
            className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-3 py-1.5 hover:bg-[color:var(--surface)]"
          >
            View leaderboard
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
