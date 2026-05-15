import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { LocalTime } from "@/components/local-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["pending", "verified", "rejected", "verifying", "paid", "reward_verified"];

export default async function AdminSubmissionsPage({ searchParams }: { searchParams: Promise<{ status?: string; projectId?: string; taskId?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = [];
  if (sp.status) filters.push(eq(submissions.status, sp.status));
  if (sp.taskId) filters.push(eq(submissions.taskId, sp.taskId));

  const db = getDb();
  // Project filter is applied via JOIN; status / taskId via direct cols.
  const baseQuery = db
    .select({
      id: submissions.id,
      userId: submissions.userId,
      taskId: submissions.taskId,
      status: submissions.status,
      submittedAt: submissions.submittedAt,
      proofUrl: submissions.proofUrl,
      proofR2Key: submissions.proofR2Key,
      taskTitle: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId));

  const whereParts = [...filters];
  if (sp.projectId) whereParts.push(eq(tasks.projectId, sp.projectId));
  const query = whereParts.length
    ? baseQuery.where(whereParts.length === 1 ? whereParts[0] : and(...whereParts))
    : baseQuery;

  const rows = await query.orderBy(desc(submissions.submittedAt)).limit(200);
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects);

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Submissions</h2>
        <span className="text-xs text-[color:var(--fg-muted)]">{rows.length} shown</span>
      </header>

      <form method="get" className="mt-4 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          <span>Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            <option value="">all</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span>Project</span>
          <select name="projectId" defaultValue={sp.projectId ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            <option value="">all</option>
            {projectRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded border border-[color:var(--border-strong)] px-3 py-1 hover:bg-[color:var(--surface)]">Filter</button>
      </form>

      <section className="mt-4 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Proof</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[color:var(--fg-muted)]">No submissions match.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--rule)] align-top">
                <td className="px-3 py-2 whitespace-nowrap"><LocalTime iso={r.submittedAt.toISOString()} /></td>
                <td className="px-3 py-2 font-mono text-xs">{r.userId.slice(0, 12)}…{r.userId.slice(-6)}</td>
                <td className="px-3 py-2">{r.projectName}</td>
                <td className="px-3 py-2">{r.taskTitle}</td>
                <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                <td className="px-3 py-2">
                  {r.proofUrl && <a href={r.proofUrl} target="_blank" rel="noopener noreferrer" className="underline">URL</a>}
                  {r.proofUrl && r.proofR2Key && " · "}
                  {r.proofR2Key && <span className="text-xs text-[color:var(--fg-muted)]">screenshot</span>}
                  {!r.proofUrl && !r.proofR2Key && <span className="text-xs text-[color:var(--fg-muted)]">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link className="underline" href={`/admin/submissions/${r.id}`}>Review</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
