import Link from "next/link";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { partnerPayoutBatches, projects } from "@/db/schema";
import { LocalTime } from "@/components/local-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/payouts — list partner_payout_batches with filters.
 *
 * Filters:
 *   - projectId (dropdown of all projects)
 *   - status: 'unpaid' (txHash null), 'paid' (txHash set, verifiedOnChain
 *     false), 'verified' (verifiedOnChain true)
 */
export default async function AdminPayoutsPage({ searchParams }: { searchParams: Promise<{ projectId?: string; status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;

  const db = getDb();
  const whereParts = [];
  if (sp.projectId) whereParts.push(eq(partnerPayoutBatches.projectId, sp.projectId));
  if (sp.status === "unpaid") whereParts.push(isNull(partnerPayoutBatches.txHash));
  else if (sp.status === "paid") whereParts.push(and(isNotNull(partnerPayoutBatches.txHash), eq(partnerPayoutBatches.verifiedOnChain, false)));
  else if (sp.status === "verified") whereParts.push(eq(partnerPayoutBatches.verifiedOnChain, true));

  const base = db
    .select({
      id: partnerPayoutBatches.id,
      projectId: partnerPayoutBatches.projectId,
      projectName: projects.name,
      rowCount: partnerPayoutBatches.rowCount,
      totalAmount: partnerPayoutBatches.totalAmount,
      txHash: partnerPayoutBatches.txHash,
      paidAt: partnerPayoutBatches.paidAt,
      verifiedOnChain: partnerPayoutBatches.verifiedOnChain,
      createdAt: partnerPayoutBatches.createdAt,
      discrepancyNote: partnerPayoutBatches.discrepancyNote,
    })
    .from(partnerPayoutBatches)
    .innerJoin(projects, eq(projects.id, partnerPayoutBatches.projectId));
  const query = whereParts.length
    ? base.where(whereParts.length === 1 ? whereParts[0] : and(...whereParts))
    : base;

  const batches = await query.orderBy(desc(partnerPayoutBatches.createdAt)).limit(200);
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects);

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Payouts</h2>
        <Link href="/admin/payouts/new" className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-sm hover:bg-[color:var(--surface)]">
          Export winners…
        </Link>
      </header>

      <form method="get" className="mt-4 flex flex-wrap gap-3 text-sm">
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
            <option value="unpaid">unpaid (no tx hash)</option>
            <option value="paid">paid (awaiting on-chain verification)</option>
            <option value="verified">verified on-chain</option>
          </select>
        </label>
        <button type="submit" className="rounded border border-[color:var(--border-strong)] px-3 py-1 hover:bg-[color:var(--surface)]">Filter</button>
        <span className="ml-auto self-center text-xs text-[color:var(--fg-muted)]">{batches.length} shown</span>
      </form>

      <section className="mt-4 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2 text-right">Rows</th>
              <th className="px-3 py-2 text-right">Total reward</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Paid at</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[color:var(--fg-muted)]">No payout batches.</td></tr>
            )}
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-[color:var(--rule)] align-top">
                <td className="px-3 py-2 whitespace-nowrap"><LocalTime iso={b.createdAt.toISOString()} /></td>
                <td className="px-3 py-2">{b.projectName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.rowCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{b.totalAmount.toLocaleString()}</td>
                <td className="px-3 py-2"><BatchStatus batch={b} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{b.paidAt ? <LocalTime iso={b.paidAt.toISOString()} /> : <span className="text-[color:var(--fg-muted)]">—</span>}</td>
                <td className="px-3 py-2 text-right">
                  <Link className="underline" href={`/admin/payouts/${b.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function BatchStatus({ batch }: { batch: { txHash: string | null; verifiedOnChain: boolean; discrepancyNote: string | null } }) {
  if (batch.verifiedOnChain) {
    return <span className="rounded bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-900">verified on-chain</span>;
  }
  if (batch.discrepancyNote) {
    return <span className="rounded bg-red-200 px-2 py-0.5 text-xs font-medium text-red-900">discrepancy</span>;
  }
  if (batch.txHash) {
    return <span className="rounded bg-purple-200 px-2 py-0.5 text-xs font-medium text-purple-900">paid · awaiting cron</span>;
  }
  return <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-900">unpaid</span>;
}
