import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, submissions, tasks, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  await requireAdmin();
  const db = getDb();
  const [projectCount, taskCount, pendingCount, verifiedCount, userCount] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)` }).from(projects).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`COUNT(*)` }).from(tasks).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`COUNT(*)` }).from(submissions).where(eq(submissions.status, "pending")).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`COUNT(*)` }).from(submissions).where(eq(submissions.status, "verified")).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`COUNT(*)` }).from(users).then((r) => Number(r[0]?.n ?? 0)),
  ]);

  const tiles = [
    { label: "Pending submissions", value: pendingCount, href: "/admin/submissions?status=pending" },
    { label: "Verified submissions", value: verifiedCount, href: "/admin/submissions?status=verified" },
    { label: "Projects", value: projectCount, href: "/admin/projects" },
    { label: "Tasks", value: taskCount, href: "/admin/tasks" },
    { label: "Users", value: userCount, href: "/admin/audit" },
  ];

  return (
    <main>
      <h2 className="text-lg font-semibold">Overview</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 hover:border-[color:var(--border-strong)]"
          >
            <div className="font-mono text-2xl">{t.value}</div>
            <div className="mt-1 text-xs text-[color:var(--fg-muted)]">{t.label}</div>
          </Link>
        ))}
      </div>
      <section className="mt-8 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
        <h3 className="font-semibold">Quick links</h3>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li><Link className="underline" href="/admin/projects">Manage projects</Link></li>
          <li><Link className="underline" href="/admin/tasks/new">Create a task</Link></li>
          <li><Link className="underline" href="/admin/submissions?status=pending">Review pending submissions</Link></li>
          <li><Link className="underline" href="/admin/audit">Audit log</Link></li>
        </ul>
      </section>
    </main>
  );
}
