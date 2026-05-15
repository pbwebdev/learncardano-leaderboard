import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { clickEvents, projects, submissions, tasks, users } from "@/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { resolvePersonalReferralLink } from "@/lib/referral-links";
import { getBatchSummaryForProject, shouldShowPayoutsVerifiedBadge } from "@/lib/payouts-badge";
import { PayoutsVerifiedBadge } from "@/components/payouts-verified-badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const row = (await getDb().select({ name: projects.name, description: projects.description, id: projects.id }).from(projects).where(eq(projects.id, slug)).limit(1))[0];
  if (!row) return { title: "Project not found" };
  const teaser = row.description.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? row.name;
  // Per-project OG card: pick the first active task as the share-card
  // subject; falls back to a project-level card by reusing the slug as
  // the "task id" key for the OG cache (the task-card renderer uses
  // projectName + title).
  return {
    title: row.name,
    description: teaser.slice(0, 160),
    openGraph: {
      title: row.name,
      description: teaser.slice(0, 160),
      // We don't have a project-only card type yet — link the first
      // task's card when one exists. UI fallback is fine; admin can
      // ensure one task is active before sharing.
    },
  };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) redirect("/");
  const { slug } = await params;
  const { submitted } = await searchParams;
  const db = getDb();
  const project = (await db.select().from(projects).where(eq(projects.id, slug)).limit(1))[0];
  if (!project) notFound();

  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, slug), eq(tasks.status, "active")))
    .orderBy(asc(tasks.displayOrder));

  // Pull this user's submissions for these tasks (one query, in-memory join).
  const taskIds = taskRows.map((t) => t.id);
  const mySubs = taskIds.length
    ? await db.select({ taskId: submissions.taskId, status: submissions.status }).from(submissions).where(eq(submissions.userId, stake))
    : [];
  const myByTask = new Map<string, string[]>();
  for (const s of mySubs) {
    const list = myByTask.get(s.taskId) ?? [];
    list.push(s.status);
    myByTask.set(s.taskId, list);
  }

  const descriptionHtml = renderMarkdown(project.description);

  const batchSummary = await getBatchSummaryForProject(slug);
  const showPayoutsBadge = shouldShowPayoutsVerifiedBadge(batchSummary);

  // Phase 3: per-user referral link. Only when the project has a
  // referralUrl configured. Resolution is lazy + non-fatal; if Dub
  // isn't configured, `shortUrl` is null and we fall back to the
  // destination URL in the UI.
  let personalRef: { shortUrl: string | null; destinationUrl: string; clicks: number } | null = null;
  if (project.referralUrl) {
    const userRow = (await db.select({ refCode: users.refCode }).from(users).where(eq(users.stakeAddress, stake)).limit(1))[0];
    if (userRow?.refCode) {
      const link = await resolvePersonalReferralLink({
        projectId: slug,
        projectReferralUrl: project.referralUrl,
        userRefCode: userRow.refCode,
      });
      let clicks = 0;
      if (link.trackedLinkId) {
        const c = (await db.select({ n: sql<number>`COUNT(*)` }).from(clickEvents).where(eq(clickEvents.trackedLinkId, link.trackedLinkId)))[0];
        clicks = Number(c?.n ?? 0);
      }
      personalRef = { shortUrl: link.shortUrl, destinationUrl: link.destinationUrl, clicks };
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {submitted && (
        <div
          role="status"
          className="mb-6 rounded-[--radius-md] border border-green-700/40 bg-green-900/20 p-4 text-sm"
        >
          <p className="font-semibold text-green-300">Submission received — thanks!</p>
          <p className="mt-1 text-[color:var(--fg-muted)]">
            An admin will review your proof. You can track the status on{" "}
            <Link href="/me" className="underline">My dashboard</Link>. Points are
            awarded on approval.
          </p>
        </div>
      )}
      <p className="text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">{project.category}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
        {showPayoutsBadge && <PayoutsVerifiedBadge />}
      </div>
      {project.websiteUrl && (
        <p className="mt-2 text-sm">
          <a href={project.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline text-[color:var(--accent-info)]">{project.websiteUrl.replace(/^https?:\/\//, "")}</a>
        </p>
      )}

      {/*
        The markdown is rendered by our hand-rolled parser (lib/markdown.ts);
        the output is HTML-escaped and limited to a safe subset, so dangerously-
        SetInnerHTML is acceptable here. Surrounding `.prose` styles keep the
        rendered output legible alongside the rest of the page chrome.
       */}
      <article className="prose mt-6 max-w-none text-sm leading-relaxed [&_a]:underline [&_h1]:mt-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_code]:rounded [&_code]:bg-[color:var(--bg-code)] [&_code]:px-1"
        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
      />

      {personalRef && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          <h2 className="font-semibold">Your personal referral link</h2>
          <p className="mt-2">
            {personalRef.shortUrl ? (
              <a href={personalRef.shortUrl} target="_blank" rel="noopener noreferrer" className="underline font-mono text-[color:var(--accent-info)]">{personalRef.shortUrl}</a>
            ) : (
              <a href={personalRef.destinationUrl} target="_blank" rel="noopener noreferrer" className="underline font-mono">{personalRef.destinationUrl}</a>
            )}
          </p>
          <p className="mt-1 text-xs text-[color:var(--fg-muted)]">Clicks: {personalRef.clicks}</p>
          {!personalRef.shortUrl && (
            <p className="mt-1 text-xs text-[color:var(--fg-muted)]">Short-link tracking is offline — the raw URL above isn&apos;t click-tracked yet.</p>
          )}
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Tasks</h2>
        {taskRows.length === 0 ? (
          <p className="mt-2 text-sm text-[color:var(--fg-muted)]">No active tasks yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {taskRows.map((t) => {
              const myStatuses = myByTask.get(t.id) ?? [];
              const hasVerified = myStatuses.includes("verified");
              const hasPending = myStatuses.includes("pending");
              const hasRejected = myStatuses.includes("rejected");
              // One submission per user per task — any prior submission of any
              // status locks the CTA. Keeps manual_review honest (otherwise a
              // user could spam resubmissions to game the reviewer).
              const lockedSingle = t.maxCompletionsPerUser === 1 && myStatuses.length > 0;
              return (
                <li key={t.id} className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold">{t.title}</h3>
                    <span className="text-xs text-[color:var(--fg-muted)]">{t.points} pts</span>
                  </div>
                  {t.descriptionMd && (
                    <p className="mt-2 text-sm text-[color:var(--fg-muted)]">{t.descriptionMd}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-sm">
                    {lockedSingle ? (
                      hasVerified ? (
                        <span className="rounded bg-green-200 px-2 py-0.5 text-xs font-medium text-green-900">Verified · {t.points} pts</span>
                      ) : hasPending ? (
                        <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-900">Pending review</span>
                      ) : hasRejected ? (
                        <span className="rounded bg-red-200 px-2 py-0.5 text-xs font-medium text-red-900">Rejected · contact admin to retry</span>
                      ) : (
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-900">Already submitted</span>
                      )
                    ) : t.taskType === "manual_review" ? (
                      <Link href={`/projects/${slug}/tasks/${t.id}/submit`} className="rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Submit proof</Link>
                    ) : (
                      <span className="text-xs text-[color:var(--fg-muted)]">Phase 2 — auto verification</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
