import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { LocalTime } from "@/components/local-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ entityType?: string; entityId?: string; adminId?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const filters = [];
  if (sp.entityType) filters.push(eq(auditLog.entityType, sp.entityType));
  if (sp.entityId) filters.push(eq(auditLog.entityId, sp.entityId));
  if (sp.adminId) filters.push(eq(auditLog.userId, sp.adminId));

  const db = getDb();
  const baseQuery = db.select().from(auditLog);
  const filtered = filters.length
    ? baseQuery.where(filters.length === 1 ? filters[0] : and(...filters))
    : baseQuery;
  const rows = await filtered.orderBy(desc(auditLog.timestamp)).limit(PAGE_SIZE).offset(offset);

  const nextPage = rows.length === PAGE_SIZE ? page + 1 : null;
  const prevPage = page > 1 ? page - 1 : null;
  const qsBase = new URLSearchParams();
  if (sp.entityType) qsBase.set("entityType", sp.entityType);
  if (sp.entityId) qsBase.set("entityId", sp.entityId);
  if (sp.adminId) qsBase.set("adminId", sp.adminId);
  const linkFor = (p: number) => {
    const q = new URLSearchParams(qsBase);
    q.set("page", String(p));
    return `/admin/audit?${q.toString()}`;
  };

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Audit log</h2>
        <span className="text-xs text-[color:var(--fg-muted)]">page {page}</span>
      </header>

      <form method="get" className="mt-4 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          <span>Entity type</span>
          <select name="entityType" defaultValue={sp.entityType ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            <option value="">all</option>
            {["submission","project","task","user","points","payout_batch"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span>Entity id</span>
          <input name="entityId" defaultValue={sp.entityId ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono" />
        </label>
        <label className="flex items-center gap-1">
          <span>Admin (stake)</span>
          <input name="adminId" defaultValue={sp.adminId ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono" />
        </label>
        <button type="submit" className="rounded border border-[color:var(--border-strong)] px-3 py-1 hover:bg-[color:var(--surface)]">Filter</button>
      </form>

      <section className="mt-4 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Old → New</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[color:var(--fg-muted)]">No audit rows match.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--rule)] align-top">
                <td className="px-3 py-2 whitespace-nowrap"><LocalTime iso={r.timestamp.toISOString()} /></td>
                <td className="px-3 py-2 font-mono text-xs">{r.userId.slice(0, 12)}…</td>
                <td className="px-3 py-2"><span className="text-xs text-[color:var(--fg-muted)]">{r.entityType}</span> <code className="text-xs">{r.entityId.slice(0, 16)}</code></td>
                <td className="px-3 py-2 font-mono text-xs">{r.field}</td>
                <td className="px-3 py-2 break-all text-xs"><code>{r.oldValue ?? "—"}</code> → <code>{r.newValue ?? "—"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav className="mt-4 flex justify-between text-sm">
        {prevPage ? <Link className="underline" href={linkFor(prevPage)}>← prev</Link> : <span />}
        {nextPage ? <Link className="underline" href={linkFor(nextPage)}>next →</Link> : <span />}
      </nav>
    </main>
  );
}
