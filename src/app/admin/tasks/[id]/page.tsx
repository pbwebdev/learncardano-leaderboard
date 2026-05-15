import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects, tasks } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { updateTask } from "../actions";
import { TaskFormFields } from "../task-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminTaskEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; created?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { saved, created } = await searchParams;
  const db = getDb();
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  const task = rows[0];
  if (!task) notFound();
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));

  return (
    <main>
      {(saved || created) && (
        <div
          role="status"
          className="mb-4 rounded-[--radius-md] border border-[color:var(--status-green)]/40 bg-[color:var(--status-green-bg)] p-3 text-sm text-[color:var(--status-green)]"
        >
          <p className="font-semibold">
            {created ? "Task created" : "Task saved"}
          </p>
          <p className="mt-1 opacity-90">
            {task.taskType} · {task.title} · status <code>{task.status}</code>
            {task.status === "active" && task.taskType !== "manual_review" && task.taskType !== "bounty_completion" && (
              <> — submissions will route through the verifier within ~10 seconds.</>
            )}
          </p>
        </div>
      )}
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Edit task</h2>
        <Link className="text-sm underline" href="/admin/tasks">All tasks</Link>
      </header>
      <SaveForm action={updateTask} className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <TaskFormFields
          projects={projectRows}
          lockProject
          defaults={{
            id: task.id,
            projectId: task.projectId,
            title: task.title,
            descriptionMd: task.descriptionMd,
            taskType: task.taskType,
            taskConfig: task.taskConfig,
            points: task.points,
            startsAt: task.startsAt,
            endsAt: task.endsAt,
            maxCompletionsPerUser: task.maxCompletionsPerUser,
            totalCompletionCap: task.totalCompletionCap,
            displayOrder: task.displayOrder,
            status: task.status,
          }}
        />
        <button type="submit" className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Save changes</button>
      </SaveForm>
    </main>
  );
}
