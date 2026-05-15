import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { projects, submissions, tasks, users } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { parseManualReviewConfig } from "@/lib/verification/manual";
import { canSubmitForTask } from "@/lib/submissions";
import { isTaskTypeEnabledInPhase3 } from "@/lib/verification";
import { isXConfigured } from "@/lib/oauth/x";
import { isYouTubeConfigured } from "@/lib/oauth/youtube";
import { submitTask } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TX_HASH_TYPES = new Set(["tx_swap", "asset_purchase"]);
const READ_ONLY_TYPES = new Set([
  "pool_delegation",
  "drep_delegation",
  "drep_registered",
  "governance_vote",
]);
const X_TYPES = new Set(["x_tweet", "x_retweet"]);
const YT_TYPES = new Set(["youtube_comment"]);

export default async function SubmitTaskPage({ params }: { params: Promise<{ slug: string; taskId: string }> }) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) redirect("/");
  const { slug, taskId } = await params;
  const db = getDb();

  const project = (await db.select().from(projects).where(eq(projects.id, slug)).limit(1))[0];
  if (!project) notFound();
  const task = (await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, slug))).limit(1))[0];
  if (!task) notFound();

  if (!isTaskTypeEnabledInPhase3(task.taskType)) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">This task type isn&apos;t live yet</h1>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">Phase 3 supports manual review, on-chain auto-verification, and X/YouTube OAuth tasks. Bounty-webhook tasks land in Phase 4.</p>
        <p className="mt-4 text-sm"><Link href={`/projects/${slug}`} className="underline">Back to {project.name}</Link></p>
      </main>
    );
  }

  const priorSubs = await db
    .select({ userId: submissions.userId, taskId: submissions.taskId, status: submissions.status })
    .from(submissions)
    .where(eq(submissions.userId, stake));
  const eligibility = canSubmitForTask({ task, priorSubmissions: priorSubs, now: Date.now() });

  const isManual = task.taskType === "manual_review";
  const isTxHash = TX_HASH_TYPES.has(task.taskType);
  const isReadOnly = READ_ONLY_TYPES.has(task.taskType);
  const isXType = X_TYPES.has(task.taskType);
  const isYtType = YT_TYPES.has(task.taskType);
  const isTweetUrl = task.taskType === "x_tweet";

  // For OAuth task types, surface "Connect X / YouTube" CTA when the
  // user hasn't linked yet (xUserId/youtubeChannelId not populated).
  // Verifiers also detect this and return needs_review — the UI gate
  // saves a round-trip.
  let xLinked = false;
  let ytLinked = false;
  if (isXType || isYtType) {
    const u = (await db.select({ x: users.xUserId, yt: users.youtubeChannelId }).from(users).where(eq(users.stakeAddress, stake)).limit(1))[0];
    xLinked = !!u?.x;
    ytLinked = !!u?.yt;
  }
  const xConfigured = isXType ? isXConfigured() : true;
  const ytConfigured = isYtType ? isYouTubeConfigured() : true;

  let manualCfg: ReturnType<typeof parseManualReviewConfig> | null = null;
  if (isManual) {
    try {
      manualCfg = parseManualReviewConfig(task.taskConfig);
    } catch (e) {
      return (
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-2xl font-bold">Task misconfigured</h1>
          <p className="mt-2 text-sm text-[color:var(--fg-muted)]">{(e as Error).message}</p>
        </main>
      );
    }
  }

  const verifyHint = isManual
    ? "Manual review · admin approves"
    : isTxHash
      ? "On-chain auto-verify · paste your tx hash"
      : isXType
        ? "Auto-verify via X · we check your linked account"
        : isYtType
          ? "Auto-verify via YouTube · we check your linked channel"
          : "On-chain auto-verify · we read your current state";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)]"><Link href={`/projects/${slug}`} className="underline">{project.name}</Link></p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{task.title}</h1>
      <p className="mt-1 text-xs text-[color:var(--fg-muted)]">{verifyHint} · {task.points} pts on approval</p>

      {manualCfg && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <h2 className="font-semibold">Instructions</h2>
          <p className="mt-2 whitespace-pre-line">{manualCfg.instructions}</p>
        </section>
      )}

      {isReadOnly && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <p>Submit this task to enqueue verification. We&apos;ll read your current delegation / DRep status directly from the chain — no extra proof needed.</p>
        </section>
      )}

      {isXType && !xConfigured && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-4 text-sm">
          <p>X integration isn&apos;t configured yet. Peter is wiring this up — check back soon.</p>
        </section>
      )}
      {isXType && xConfigured && !xLinked && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <p>This task verifies via your X (Twitter) account. Link it first, then submit.</p>
          <a
            href={`/api/oauth/x/start?returnTo=${encodeURIComponent(`/projects/${slug}/tasks/${task.id}/submit`)}`}
            className="mt-3 inline-flex w-full items-center justify-center rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)] sm:w-auto sm:px-3 sm:py-1.5"
          >
            Connect X
          </a>
        </section>
      )}

      {isYtType && !ytConfigured && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-4 text-sm">
          <p>YouTube integration isn&apos;t configured yet. Peter is wiring this up — check back soon.</p>
        </section>
      )}
      {isYtType && ytConfigured && !ytLinked && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <p>This task verifies via your YouTube channel. Link it first, then submit.</p>
          <a
            href={`/api/oauth/youtube/start?returnTo=${encodeURIComponent(`/projects/${slug}/tasks/${task.id}/submit`)}`}
            className="mt-3 inline-flex w-full items-center justify-center rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)] sm:w-auto sm:px-3 sm:py-1.5"
          >
            Connect YouTube
          </a>
        </section>
      )}

      {!eligibility.ok ? (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-4 text-sm">
          <p className="font-semibold">You can&apos;t submit this task right now.</p>
          <p className="mt-1 text-[color:var(--fg-muted)]">Reason: <code className="text-xs">{eligibility.reason}</code></p>
        </section>
      ) : (
        <SaveForm action={submitTask} className="mt-6 grid gap-3 text-sm">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="projectSlug" value={project.id} />
          {isManual && manualCfg?.requiresProofUrl && (
            <label className="flex flex-col gap-1">
              <span>Proof URL <span className="text-[color:var(--fg-muted)]">(https://…)</span></span>
              <input name="proofUrl" type="url" required placeholder="https://x.com/you/status/123" className="w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2" />
            </label>
          )}
          {isManual && manualCfg?.requiresScreenshot && (
            <label className="flex flex-col gap-1">
              <span>Screenshot <span className="text-[color:var(--fg-muted)]">(PNG/JPEG/WEBP, max 5 MB)</span></span>
              <input name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" required className="text-xs file:tap-target file:mr-3 file:rounded-[--radius-md] file:border file:border-[color:var(--border-strong)] file:bg-[color:var(--bg-elevated)] file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-[color:var(--bg-subtle)]" />
            </label>
          )}
          {isTxHash && (
            <label className="flex flex-col gap-1">
              <span>Transaction hash <span className="text-[color:var(--fg-muted)]">(64 hex chars)</span></span>
              <input
                name="txHash"
                required
                pattern="[0-9a-fA-F]{64}"
                placeholder="abc123…"
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs"
              />
            </label>
          )}
          {isTweetUrl && xLinked && xConfigured && (
            <label className="flex flex-col gap-1">
              <span>Tweet URL</span>
              <input
                name="proofUrl"
                type="url"
                required
                placeholder="https://x.com/you/status/123…"
                className="w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2"
              />
              <span className="text-xs text-[color:var(--fg-muted)]">Paste the link to your tweet that includes the required hashtags / mentions.</span>
            </label>
          )}
          <button type="submit" className="mt-2 w-full sm:w-auto sm:self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Submit{isManual ? " for review" : ""}</button>
          <p className="text-xs text-[color:var(--fg-muted)]">{isManual ? "Your submission will appear in the admin queue. Points are awarded on approval." : "We&apos;ll verify on-chain automatically — usually within a minute. Refresh your dashboard to see the result."}</p>
        </SaveForm>
      )}
    </main>
  );
}
