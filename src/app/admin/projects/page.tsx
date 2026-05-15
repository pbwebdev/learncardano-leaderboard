import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { createProject } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  await requireAdmin();
  const rows = await getDb().select().from(projects).orderBy(asc(projects.displayOrder), asc(projects.name));

  return (
    <main>
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <span className="text-xs text-[color:var(--fg-muted)]">{rows.length} total</span>
      </header>

      <section className="mt-4 overflow-hidden rounded-[--radius-md] border border-[color:var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--surface)] text-left text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">
            <tr>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-[color:var(--fg-muted)]">No projects yet.</td></tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-[color:var(--rule)]">
                <td className="px-3 py-2 font-mono">{p.id}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.category}</td>
                <td className="px-3 py-2">{p.status}</td>
                <td className="px-3 py-2">{p.displayOrder}</td>
                <td className="px-3 py-2 text-right">
                  <Link className="underline" href={`/admin/projects/${p.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <h3 className="font-semibold">Create a project</h3>
        <SaveForm action={createProject} className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span>Slug (URL id)</span>
            <input name="id" required pattern="[a-z0-9][a-z0-9-]{0,40}[a-z0-9]" placeholder="minswap"
              className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Name</span>
            <input name="name" required className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Category</span>
            <select name="category" defaultValue="infra" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
              {["defi","nft","governance","infra","education","gaming"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Status</span>
            <select name="status" defaultValue="draft" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
              {["draft","active","upcoming","ended"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span>Description (markdown)</span>
            <textarea name="description" rows={5} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Website URL</span>
            <input name="websiteUrl" type="url" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Referral URL</span>
            <input name="referralUrl" type="url" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Display order</span>
            <input name="displayOrder" type="number" defaultValue={0} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span>Campaign start date</span>
            <input name="campaignStartDate" type="date" className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
          </label>
          <button type="submit" className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Create project</button>
        </SaveForm>
      </section>
    </main>
  );
}
