import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { auditLog, projects, submissions, tasks } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { LocalTime } from "@/components/local-time";
import { approveSubmission, rejectSubmission, addSubmissionNote } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();
  const row = (
    await db
      .select({
        sub: submissions,
        task: tasks,
        project: projects,
      })
      .from(submissions)
      .innerJoin(tasks, eq(tasks.id, submissions.taskId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(submissions.id, id))
      .limit(1)
  )[0];
  if (!row) notFound();

  const history = await db
    .select()
    .from(submissions)
    .where(eq(submissions.userId, row.sub.userId))
    .orderBy(desc(submissions.submittedAt))
    .limit(20);

  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, "submission"), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.timestamp))
    .limit(50);

  const sub = row.sub;
  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Submission detail</h2>
        <Link className="text-sm underline" href="/admin/submissions">All submissions</Link>
      </header>

      <section className="mt-4 grid gap-3 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm md:grid-cols-2">
        <Detail label="Project"><Link className="underline" href={`/admin/projects/${row.project.id}`}>{row.project.name}</Link></Detail>
        <Detail label="Task"><Link className="underline" href={`/admin/tasks/${row.task.id}`}>{row.task.title}</Link> <span className="text-[color:var(--fg-muted)]">({row.task.taskType})</span></Detail>
        <Detail label="User"><span className="font-mono text-xs">{sub.userId}</span></Detail>
        <Detail label="Status">{sub.status}</Detail>
        <Detail label="Submitted"><LocalTime iso={sub.submittedAt.toISOString()} /></Detail>
        <Detail label="Verified">{sub.verifiedAt ? <LocalTime iso={sub.verifiedAt.toISOString()} /> : "—"}</Detail>
        <Detail label="Points (on approval)">{row.task.points}</Detail>
        <Detail label="Proof URL">{sub.proofUrl ? <a href={sub.proofUrl} target="_blank" rel="noopener noreferrer" className="underline break-all">{sub.proofUrl}</a> : "—"}</Detail>
        <Detail label="Screenshot R2 key">{sub.proofR2Key ? <code className="break-all text-xs">{sub.proofR2Key}</code> : "—"}</Detail>
        <Detail label="Rejection reason">{sub.rejectionReason ?? "—"}</Detail>
        <Detail label="Tx hash">{sub.txHash ? <code className="text-xs">{sub.txHash}</code> : "—"}</Detail>
        <Detail label="Admin notes">{sub.notes ?? "—"}</Detail>
      </section>

      {canReVerify(sub) && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <h3 className="font-semibold">Re-verify (auto)</h3>
          <p className="mt-1 text-[color:var(--fg-muted)]">Enqueue this submission for another auto-verification pass. Use after upstream Koios/Blockfrost recovers, or after a code deploy that fixed a verifier bug.</p>
          <form action={`/api/verify/${sub.id}`} method="post" className="mt-3">
            <button type="submit" className="rounded-[--radius-md] border border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] px-3 py-1.5 hover:bg-[color:var(--surface)]">Re-verify now</button>
          </form>
        </section>
      )}

      {sub.status === "pending" || sub.status === "verifying" ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <SaveForm action={approveSubmission} className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            <input type="hidden" name="submissionId" value={sub.id} />
            <h3 className="font-semibold">Approve</h3>
            <p className="mt-1 text-[color:var(--fg-muted)]">Sets status=verified, appends {row.task.points} pts to ledger, logs audit.</p>
            <button type="submit" className="mt-3 rounded-[--radius-md] bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700">Approve and award {row.task.points} pts</button>
          </SaveForm>
          <SaveForm action={rejectSubmission} className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            <input type="hidden" name="submissionId" value={sub.id} />
            <h3 className="font-semibold">Reject</h3>
            <label className="mt-2 flex flex-col gap-1">
              <span>Reason (required)</span>
              <input name="rejectionReason" required minLength={3} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
            </label>
            <button type="submit" className="mt-3 rounded-[--radius-md] bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">Reject submission</button>
          </SaveForm>
        </section>
      ) : (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <p className="text-[color:var(--fg-muted)]">This submission is in status <strong>{sub.status}</strong>. Use Reject below to flip a verified one back (the clawback row will be appended automatically).</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <SaveForm action={rejectSubmission}>
              <input type="hidden" name="submissionId" value={sub.id} />
              <label className="flex flex-col gap-1">
                <span>Rejection reason</span>
                <input name="rejectionReason" required minLength={3} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
              </label>
              <button type="submit" className="mt-3 rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">Reject (clawback if verified)</button>
            </SaveForm>
          </div>
        </section>
      )}

      <SaveForm action={addSubmissionNote} className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
        <input type="hidden" name="submissionId" value={sub.id} />
        <label className="flex flex-col gap-1">
          <span>Admin note (private)</span>
          <textarea name="note" defaultValue={sub.notes ?? ""} rows={3} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
        </label>
        <button type="submit" className="mt-2 rounded-[--radius-md] border border-[color:var(--border-strong)] px-3 py-1.5 hover:bg-[color:var(--bg-elevated)]">Save note</button>
      </SaveForm>

      <section className="mt-8">
        <h3 className="font-semibold">User submission history</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {history.map((h) => (
            <li key={h.id} className={h.id === sub.id ? "text-[color:var(--fg)]" : "text-[color:var(--fg-muted)]"}>
              <LocalTime iso={h.submittedAt.toISOString()} /> · task <code className="text-xs">{h.taskId.slice(0, 8)}</code> · <strong>{h.status}</strong>
              {h.id !== sub.id && <> · <Link href={`/admin/submissions/${h.id}`} className="underline">open</Link></>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h3 className="font-semibold">Audit log for this submission</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {auditRows.length === 0 && <li className="text-[color:var(--fg-muted)]">No audit entries yet.</li>}
          {auditRows.map((a) => (
            <li key={a.id} className="text-[color:var(--fg-muted)]">
              <LocalTime iso={a.timestamp.toISOString()} /> · <span className="font-mono text-xs">{a.userId.slice(0, 12)}…</span> · {a.field}: <code className="text-xs">{a.oldValue ?? "—"}</code> → <code className="text-xs">{a.newValue ?? "—"}</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/**
 * Re-verify is available for any submission stuck in the auto-verify flow.
 * Approve/Reject buttons already handle manual_review's pending state — we
 * only surface Re-verify for the on-chain pathways where another pass might
 * change the outcome. Includes rejected submissions whose reason was a
 * recoverable upstream / unconfirmed condition.
 */
function canReVerify(sub: {
  status: string;
  rejectionReason?: string | null;
  taskId?: string;
}): boolean {
  if (sub.status === "pending" || sub.status === "verifying") return true;
  if (sub.status === "rejected") {
    const r = sub.rejectionReason ?? "";
    return (
      r === "verifier_unavailable" ||
      r === "unconfirmed" ||
      r.startsWith("needs_review")
    );
  }
  return false;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
