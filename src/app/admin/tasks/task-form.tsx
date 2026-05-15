import { ALL_TASK_TYPES, isAdminCreatableTaskType, taskTypeLabelSuffix } from "@/lib/verification";

/**
 * Shared task form fields. Rendered inside a <SaveForm> on the parent page
 * so the full-reload pattern (save-form.tsx) handles submission. The form
 * is task-type-aware: Phase 1 only enables manual_review, but the dropdown
 * shows all 10 types greyed so admins can see what's coming.
 *
 * The manual_review config inputs map to fields cfg_* which the server
 * action assembles into a JSON blob and parses via parseManualReviewConfig
 * at save time (Zod-style re-validation).
 */
export function TaskFormFields(props: {
  defaults: {
    id?: string;
    projectId: string;
    title: string;
    descriptionMd: string;
    taskType: string;
    taskConfig: unknown;
    points: number;
    startsAt: Date | null;
    endsAt: Date | null;
    maxCompletionsPerUser: number;
    totalCompletionCap: number;
    displayOrder: number;
    status: string;
  };
  projects: ReadonlyArray<{ id: string; name: string }>;
  lockProject?: boolean;
}) {
  const d = props.defaults;
  const cfg = (d.taskConfig ?? {}) as Record<string, unknown>;

  function dateStr(x: Date | null): string {
    if (!x) return "";
    return x.toISOString().slice(0, 16); // for datetime-local
  }

  return (
    <>
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <label className="flex flex-col gap-1">
        <span>Project</span>
        <select name="projectId" defaultValue={d.projectId} required disabled={props.lockProject} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 disabled:opacity-60">
          {!d.projectId && <option value="">— pick a project —</option>}
          {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {props.lockProject && <input type="hidden" name="projectId" value={d.projectId} />}
      </label>
      <label className="flex flex-col gap-1">
        <span>Title</span>
        <input name="title" defaultValue={d.title} required className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span>Description (markdown shown on the public task card)</span>
        <textarea name="descriptionMd" rows={4} defaultValue={d.descriptionMd} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
      </label>

      <label className="flex flex-col gap-1">
        <span>Task type</span>
        <select name="taskType" defaultValue={d.taskType || "manual_review"} required className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
          {ALL_TASK_TYPES.map((t) => (
            <option key={t} value={t} disabled={!isAdminCreatableTaskType(t)}>
              {t}{taskTypeLabelSuffix(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>Status</span>
        <select name="status" defaultValue={d.status || "draft"} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1">
          {["draft","active","paused","ended"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <fieldset className="md:col-span-2 rounded border border-dashed border-[color:var(--border)] p-3">
        <legend className="px-1 text-xs uppercase tracking-wide text-[color:var(--fg-muted)]">manual_review config</legend>
        <label className="flex flex-col gap-1">
          <span>Instructions (shown to the user on the submission page)</span>
          <textarea name="cfg_instructions" rows={3} defaultValue={String(cfg.instructions ?? "")} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1 font-mono text-xs" />
        </label>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="cfg_requiresProofUrl" defaultChecked={cfg.requiresProofUrl !== false} /> requires proof URL</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="cfg_requiresScreenshot" defaultChecked={Boolean(cfg.requiresScreenshot)} /> requires screenshot</label>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span>Points</span>
        <input name="points" type="number" defaultValue={d.points} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Display order</span>
        <input name="displayOrder" type="number" defaultValue={d.displayOrder} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Max completions per user</span>
        <input name="maxCompletionsPerUser" type="number" min={1} defaultValue={d.maxCompletionsPerUser} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Total completion cap (0 = no cap)</span>
        <input name="totalCompletionCap" type="number" min={0} defaultValue={d.totalCompletionCap} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Starts at</span>
        <input name="startsAt" type="datetime-local" defaultValue={dateStr(d.startsAt)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Ends at (optional)</span>
        <input name="endsAt" type="datetime-local" defaultValue={dateStr(d.endsAt)} className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1" />
      </label>
    </>
  );
}
