import { and, eq, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { exportPayoutBatch } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/payouts/new — "Export winners" form.
 *
 * Lists projects that have at least one `verified` + unbatched submission
 * (otherwise the export would 400). Admin picks project + optional date
 * range, server action emits CSV → R2, creates batch row, redirects to
 * batch detail.
 */
export default async function NewPayoutBatchPage() {
  await requireAdmin();
  const db = getDb();

  // Projects with at least one eligible submission. Single grouped query so
  // we can show an "X submissions ready" hint per project.
  const eligible = await db
    .select({
      projectId: tasks.projectId,
      projectName: projects.name,
      eligibleCount: sql<number>`COUNT(${submissions.id})`,
    })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(submissions.status, "verified"), isNull(submissions.payoutBatchId)))
    .groupBy(tasks.projectId, projects.name);

  return (
    <main className="max-w-xl">
      <header>
        <h2 className="text-lg font-semibold">Export winners</h2>
        <p className="mt-1 text-sm text-[color:var(--fg-muted)]">
          Emits a CSV with one row per (user, asset), groups submission IDs, uploads to R2, and links submissions to the new batch.
          Submissions move to <code>paid_pending</code>.
        </p>
      </header>

      {eligible.length === 0 ? (
        <p className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--fg-muted)]">
          No verified-and-unbatched submissions yet. Approve some submissions or wait for the verifier to run.
        </p>
      ) : (
        <form action={exportPayoutBatch} className="mt-6 space-y-4 text-sm">
          <label className="block">
            <span className="block font-medium">Project</span>
            <select name="projectId" required className="mt-1 w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
              <option value="">— pick one —</option>
              {eligible.map((e) => (
                <option key={e.projectId} value={e.projectId}>
                  {e.projectName} ({Number(e.eligibleCount)} ready)
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block font-medium">Verified from (optional)</span>
              <input
                type="date"
                name="from"
                className="mt-1 w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="block font-medium">Verified to (optional)</span>
              <input
                type="date"
                name="to"
                className="mt-1 w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1"
              />
            </label>
          </div>

          <button
            type="submit"
            className="rounded border border-[color:var(--border-strong)] bg-[color:var(--fg)] px-3 py-1 text-[color:var(--bg)] hover:opacity-90"
          >
            Export CSV
          </button>
        </form>
      )}
    </main>
  );
}
