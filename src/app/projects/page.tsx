import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { getBatchSummariesForProjects, shouldShowPayoutsVerifiedBadge } from "@/lib/payouts-badge";
import { PayoutsVerifiedBadge } from "@/components/payouts-verified-badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Projects",
  description: "Partnered Cardano projects with active tasks, on-chain rewards, and verified payouts.",
};

export default async function ProjectsPage() {
  // Server-gate the gallery — the client-side WalletGate is fragile under
  // Brave's wallet shim (GOTCHAS.md). Redirect unauth'd users to landing.
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) redirect("/");

  const rows = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(asc(projects.displayOrder), asc(projects.name));

  // Per-project batch counts for the "Payouts verified" badge. One round-trip
  // for the whole gallery rather than N+1.
  const batchSummaries = await getBatchSummariesForProjects(rows.map((r) => r.id));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
      <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
        Cardano projects we have partnered with. Complete tasks to earn points.
      </p>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-6 font-sans">
          <h2 className="text-base font-semibold">No active projects yet</h2>
          <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
            Check back soon — the first wave of partners is onboarding now.
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 hover:border-[color:var(--border-strong)]">
              <Link href={`/projects/${p.id}`} className="block">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{p.name}</h2>
                  {(() => {
                    const s = batchSummaries.get(p.id) ?? { total: 0, verified: 0 };
                    return shouldShowPayoutsVerifiedBadge(s) ? <PayoutsVerifiedBadge compact /> : null;
                  })()}
                </div>
                <p className="mt-1 text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">{p.category}</p>
                <p className="mt-3 line-clamp-3 text-sm text-[color:var(--fg-muted)]">
                  {p.description.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "—"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
