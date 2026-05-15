import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { parseManualReviewConfig } from "@/lib/verification/manual";
import { canSubmitForTask } from "@/lib/submissions";
import { submitManualReview } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SubmitTaskPage({ params }: { params: Promise<{ slug: string; taskId: string }> }) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) redirect("/");
  const { slug, taskId } = await params;
  const db = getDb();

  const project = (await db.select().from(projects).where(eq(projects.id, slug)).limit(1))[0];
  if (!project) notFound();
  const task = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, slug))).limit(1))[0];
  if (!task) notFound();

  if (task.taskType !== "manual_review") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">This task type isn&apos;t live yet</h1>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">Phase 1 only supports manual review tasks. Check back next phase.</p>
        <p className="mt-4 text-sm"><Link href={`/projects/${slug}`} className="underline">Back to {project.name}</Link></p>
      </main>
    );
  }

  // Eligibility pre-flight so we render a useful message rather than the
  // server-action throw if they hit the page after completing.
  const priorSubs = await db
    .select({ userId: submissions.userId, taskId: submissions.taskId, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.userId, stake));
  const eligibility = canSubmitForTask({ task, priorSubmissions: priorSubs, now: Date.now() });

  // Re-parse task config; surface a friendly error if admin saved it
  // malformed (shouldn't happen — admin save also validates).
  let cfg;
  try {
    cfg = parseManualReviewConfig(task.taskConfig);
  } catch (e) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">Task misconfigured</h1>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">{(e as Error).message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)]"><Link href={`/projects/${slug}`} className="underline">{project.name}</Link></p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{task.title}</h1>
      <p className="mt-1 text-xs text-[color:var(--fg-muted)]">Manual review · {task.points} pts on approval</p>

      <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
        <h2 className="font-semibold">Instructions</h2>
        <p className="mt-2 whitespace-pre-line">{cfg.instructions}</p>
      </section>

      {!eligibility.ok ? (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-4 text-sm">
          <p className="font-semibold">You can&apos;t submit this task right now.</p>
          <p className="mt-1 text-[color:var(--fg-muted)]">Reason: <code className="text-xs">{eligibility.reason}</code></p>
        </section>
      ) : (
        <SaveForm action={submitManualReview} className="mt-6 grid gap-3 text-sm">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectSlug" value={project.id} />
          {cfg.requiresProofUrl && (
            <label className="flex flex-col gap-1">
              <span>Proof URL <span className="text-[color:var(--fg-muted)]">(https://…)</span></span>
              <input name="proofUrl" type="url" required placeholder="https://x.com/you/status/123" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
            </label>
          )}
          {cfg.requiresScreenshot && (
            <label className="flex flex-col gap-1">
              <span>Screenshot <span className="text-[color:var(--fg-muted)]">(PNG/JPEG/WEBP, max 5 MB)</span></span>
              <input name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" required className="text-xs" />
            </label>
          )}
          <button type="submit" className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Submit for review</button>
          <p className="text-xs text-[color:var(--fg-muted)]">Your submission will appear in the admin queue. Points are awarded on approval.</p>
        </SaveForm>
      )}
    </main>
  );
}
