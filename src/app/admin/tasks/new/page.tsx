import { asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { projects } from "@/db/schema";
import { SaveForm } from "@/components/save-form";
import { createTask } from "../actions";
import { TaskFormFields } from "../task-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const projectRows = await getDb().select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name));

  return (
    <main>
      <h2 className="text-lg font-semibold">New task</h2>
      <SaveForm action={createTask} className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <TaskFormFields
          projects={projectRows}
          lockProject={Boolean(sp.projectId)}
          defaults={{
            projectId: sp.projectId ?? "",
            title: "",
            descriptionMd: "",
            taskType: "manual_review",
            taskConfig: { instructions: "", requiresProofUrl: true, requiresScreenshot: false },
            points: 10,
            startsAt: null,
            endsAt: null,
            maxCompletionsPerUser: 1,
            totalCompletionCap: 0,
            displayOrder: 0,
            status: "draft",
          }}
        />
        <button type="submit" className="mt-2 self-start rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 font-medium text-white hover:bg-[color:var(--accent-primary-strong)]">Create task</button>
      </SaveForm>
    </main>
  );
}
