import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, tasks } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<{ projectId?: string; status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = [];
  if (sp.projectId) filters.push(eq(tasks.projectId, sp.projectId));
  if (sp.status) filters.push(eq(tasks.status, sp.status));
  const where = filters.length ? (filters.length === 1 ? filters[0] : and(...filters)) : undefined;

  const db = getDb();
  const rows = await (where
    ? db.select().from(tasks).where(where).orderBy(asc(tasks.displayOrder))
    : db.select().from(tasks).orderBy(asc(tasks.displayOrder)));
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <Link className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-3 py-1.5 text-sm hover:bg-[color:var(--surface)]" href="/admin/tasks/new">New task</Link>
      </header>

      <form className="mt-4 flex flex-wrap gap-3 text-sm" method="get">
        <label className="flex items-center gap-1">
          <span>Project</span>
          <select name="projectId" defaultValue={sp.projectId ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            <option value="">all</option>
            {projectRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span>Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            <option value="">all</option>
            {["draft","active","paused","ended"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded border border-[color:var(--border-strong)] px-3 py-1 hover:bg-[color:var(--surface)]">Filter</button>
      </form>

      <section className="mt-4 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Points</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-[color:var(--fg-muted)]">No tasks.</td></tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-[color:var(--rule)]">
                <td className="px-3 py-2">{t.title}</td>
                <td className="px-3 py-2 font-mono">{projectName.get(t.projectId) ?? t.projectId}</td>
                <td className="px-3 py-2 font-mono text-xs">{t.taskType}</td>
                <td className="px-3 py-2">{t.points}</td>
                <td className="px-3 py-2">{t.status}</td>
                <td className="px-3 py-2 text-right"><Link className="underline" href={`/admin/tasks/${t.id}`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
