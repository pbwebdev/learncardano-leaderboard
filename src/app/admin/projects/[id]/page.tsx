import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { updateProject } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminProjectEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const project = rows[0];
  if (!project) notFound();

  // Slug lock indicator: count submissions across tasks in this project.
  const subCountRow = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .where(eq(tasks.projectId, id));
  const submissionCount = Number(subCountRow[0]?.n ?? 0);
  const slugLocked = submissionCount > 0;

  const taskRows = await db.select().from(tasks).where(eq(tasks.projectId, id));

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Edit project: <span className="font-mono">{project.id}</span></h2>
        <Link className="text-sm underline" href="/admin/projects">All projects</Link>
      </header>

      <SaveForm action={updateProject} className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <input type="hidden" name="id" value={project.id} />
        <label className="flex flex-col gap-1">
          <span>Slug {slugLocked && <em className="text-xs text-[color:var(--accent-warning)]">(locked — {submissionCount} submission{submissionCount === 1 ? "" : "s"} exist)</em>}</span>
          <input
            name="newSlug"
            defaultValue={project.id}
            disabled={slugLocked}
            pattern="[a-z0-9][a-z0-9-]{0,40}[a-z0-9]"
            className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Name</span>
          <input name="name" defaultValue={project.name} required className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Category</span>
          <select name="category" defaultValue={project.category} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            {["defi","nft","governance","infra","education","gaming"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Status</span>
          <select name="status" defaultValue={project.status} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
            {["draft","active","upcoming","ended"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span>Description (markdown)</span>
          <textarea name="description" rows={6} defaultValue={project.description} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Website URL</span>
          <input name="websiteUrl" type="url" defaultValue={project.websiteUrl ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Referral URL</span>
          <input name="referralUrl" type="url" defaultValue={project.referralUrl ?? ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span>Display order</span>
          <input name="displayOrder" type="number" defaultValue={project.displayOrder} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
        </label>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" name="featured" defaultChecked={project.featured} />
          <span>Featured on landing page</span>
        </label>
        <label className="flex flex-col gap-1">
          <span>Campaign start date</span>
          <input name="campaignStartDate" type="date" defaultValue={project.campaignStartDate ? project.campaignStartDate.toISOString().slice(0, 10) : ""} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
        </label>
        <fieldset className="md:col-span-2 mt-2 rounded border border-dashed border-[color:var(--border)] p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            Partner discovery (admin-only, never shown publicly)
          </legend>
          <p className="mt-1 text-xs text-[color:var(--fg-muted)]">
            Paste what the partner shared via DM — script hash, redeemer tag,
            constructor index, mint policy, anything. Copy values from here
            into the task config when wiring <code>tx_swap</code> strict
            verification. Markdown is fine.
          </p>
          <textarea
            name="partnerNotes"
            rows={8}
            defaultValue={project.partnerNotes ?? ""}
            placeholder={"Contact: @handle (DM 2026-05-15)\n\nscript hash: …\nredeemer tag: spend\nctor 0 = …, ctor 1 = …\n\nmint policy: …"}
            className="mt-2 w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs"
          />
        </fieldset>
        <button type="submit" className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Save changes</button>
      </SaveForm>

      <section className="mt-8">
        <h3 className="font-semibold">Tasks for this project</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {taskRows.length === 0 && <li className="text-[color:var(--fg-muted)]">No tasks yet. <Link href={`/admin/tasks/new?projectId=${project.id}`} className="underline">Create one</Link>.</li>}
          {taskRows.map((t) => (
            <li key={t.id}>
              <Link className="underline" href={`/admin/tasks/${t.id}`}>{t.title}</Link>
              <span className="ml-2 text-[color:var(--fg-muted)]">{t.taskType} · {t.status} · {t.points} pts</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
