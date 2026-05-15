import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { partnerPayoutBatches, projects, submissions } from "@/db/schema";
import { LocalTime } from "@/components/local-time";
import { parseCsv } from "@/lib/payouts";
import { recordPayoutTxHash } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/payouts/[batchId] — batch detail.
 *
 *  - Shows CSV preview (first 20 rows), totals, recorded-by, paid-at, on-chain state.
 *  - "Download CSV" link to the per-request route (no signed URL — admin-only).
 *  - "Record tx hash" form if txHash null; surfaces discrepancy report when set.
 */
export default async function PayoutBatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  await requireAdmin();
  const { batchId } = await params;
  const db = getDb();

  const row = (
    await db
      .select({
        id: partnerPayoutBatches.id,
        projectId: partnerPayoutBatches.projectId,
        projectName: projects.name,
        csvR2Key: partnerPayoutBatches.csvR2Key,
        rowCount: partnerPayoutBatches.rowCount,
        totalAmount: partnerPayoutBatches.totalAmount,
        txHash: partnerPayoutBatches.txHash,
        paidAt: partnerPayoutBatches.paidAt,
        verifiedOnChain: partnerPayoutBatches.verifiedOnChain,
        discrepancyNote: partnerPayoutBatches.discrepancyNote,
        recordedByUserId: partnerPayoutBatches.recordedByUserId,
        createdAt: partnerPayoutBatches.createdAt,
      })
      .from(partnerPayoutBatches)
      .innerJoin(projects, eq(projects.id, partnerPayoutBatches.projectId))
      .where(eq(partnerPayoutBatches.id, batchId))
      .limit(1)
  )[0];
  if (!row) notFound();

  const linkedCount = (
    await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.payoutBatchId, batchId))
  ).length;

  // Fetch CSV preview (best-effort).
  let csvPreview: string[] = [];
  try {
    const { env } = getCloudflareContext();
    const r2 = (env as unknown as { R2?: R2Bucket }).R2;
    if (r2) {
      const obj = await r2.get(row.csvR2Key);
      if (obj) {
        const text = await obj.text();
        const parsed = parseCsv(text).slice(0, 20);
        csvPreview = parsed.map((p) =>
          [
            short(p.paymentAddress, 18),
            short(p.stakeAddress, 18),
            p.totalReward.toLocaleString(),
            p.asset,
            p.submissionIds.length + " sub(s)",
            p.completedAt,
          ].join("  ·  "),
        );
      }
    }
  } catch (e) {
    console.warn("[admin:payouts:detail] csv preview failed", e);
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Payout batch · {row.projectName}</h2>
          <p className="text-xs text-[color:var(--fg-muted)]">
            <span className="font-mono">{row.id}</span> · created <LocalTime iso={row.createdAt.toISOString()} />
          </p>
        </div>
        <a
          href={`/admin/payouts/${row.id}/csv`}
          className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-sm hover:bg-[color:var(--surface)]"
        >
          Download CSV
        </a>
      </header>

      <section className="grid grid-cols-2 gap-4 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm md:grid-cols-4">
        <Stat label="Rows" value={String(row.rowCount)} />
        <Stat label="Linked submissions" value={String(linkedCount)} />
        <Stat label="Total reward (raw)" value={row.totalAmount.toLocaleString()} />
        <Stat label="On-chain" value={row.verifiedOnChain ? "verified" : row.txHash ? "awaiting cron" : "unpaid"} />
      </section>

      {row.txHash ? (
        <section className="space-y-2 rounded-[--radius-md] border border-[color:var(--border)] p-4 text-sm">
          <p><span className="text-[color:var(--fg-muted)]">tx hash:</span> <span className="font-mono text-xs">{row.txHash}</span></p>
          {row.paidAt && <p><span className="text-[color:var(--fg-muted)]">paid at:</span> <LocalTime iso={row.paidAt.toISOString()} /></p>}
          {row.recordedByUserId && <p><span className="text-[color:var(--fg-muted)]">recorded by:</span> <span className="font-mono text-xs">{short(row.recordedByUserId, 22)}</span></p>}
          {row.verifiedOnChain ? (
            <p className="rounded bg-emerald-100 px-2 py-1 text-emerald-900">On-chain outputs match the CSV. Submissions moved to <code>reward_verified</code>.</p>
          ) : row.discrepancyNote ? (
            <div className="rounded bg-red-100 p-2 text-red-900">
              <p className="font-medium">Discrepancy detected</p>
              <pre className="mt-1 whitespace-pre-wrap text-xs">{row.discrepancyNote}</pre>
            </div>
          ) : (
            <p className="text-[color:var(--fg-muted)]">Pending on-chain verification (next daily cron tick at 03:15 UTC).</p>
          )}
        </section>
      ) : (
        <section className="rounded-[--radius-md] border border-[color:var(--border)] p-4 text-sm">
          <h3 className="font-medium">Record tx hash</h3>
          <p className="mt-1 text-xs text-[color:var(--fg-muted)]">
            Paste the partner&apos;s payout transaction hash. Submissions in this batch move to <code>paid</code>; the daily
            cron will verify outputs match the CSV.
          </p>
          <form action={recordPayoutTxHash} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="batchId" value={row.id} />
            <label className="flex-1">
              <span className="block text-xs text-[color:var(--fg-muted)]">Tx hash (64 hex chars)</span>
              <input
                name="txHash"
                required
                pattern="[0-9a-fA-F]{64}"
                placeholder="abcd…"
                className="mt-1 w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs"
              />
            </label>
            <button type="submit" className="rounded border border-[color:var(--border-strong)] bg-[color:var(--fg)] px-3 py-1 text-[color:var(--bg)] hover:opacity-90">
              Record
            </button>
          </form>
        </section>
      )}

      <section>
        <h3 className="font-medium">CSV preview (first 20 rows)</h3>
        <pre className="mt-2 overflow-x-auto rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-xs">
          {csvPreview.length === 0
            ? "(csv not loaded — see Download CSV)"
            : csvPreview.join("\n")}
        </pre>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">{label}</div>
      <div className="mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function short(s: string, head: number): string {
  if (!s) return "—";
  if (s.length <= head + 8) return s;
  return s.slice(0, head) + "…" + s.slice(-6);
}
