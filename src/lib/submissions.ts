/**
 * Pure-logic helpers for submission server actions. These are split out
 * of the action handlers so they can be unit-tested without a DB.
 *
 * Used by /projects/[slug]/tasks/[taskId]/submit/actions.ts and the
 * admin approve/reject actions.
 */

import { parseManualReviewConfig } from "./verification/manual";

export interface TaskLike {
  id: string;
  status: string;
  startsAt?: Date | number | null;
  endsAt?: Date | number | null;
  maxCompletionsPerUser: number;
  taskType: string;
  taskConfig: unknown;
}

export interface SubmissionLike {
  userId: string;
  taskId: string;
  status: string;
}

export type SubmissionEligibility =
  | { ok: true }
  | { ok: false; reason: "task_not_active" | "task_not_started" | "task_ended" | "already_completed" | "unsupported_task_type" };

/**
 * Eligibility check before a user submits. Pure: takes the task + their
 * prior submissions and returns a discriminated result.
 *
 * Rules:
 *   - task.status must be 'active'
 *   - now must be within [startsAt, endsAt] when set
 *   - if maxCompletionsPerUser === 1 (default), reject if a verified
 *     submission already exists; pending submissions are allowed to
 *     remain in queue (admin can reject and re-submit)
 *   - Phase 1: only manual_review is allowed; other types return
 *     unsupported_task_type
 */
export function canSubmitForTask(opts: {
  task: TaskLike;
  priorSubmissions: ReadonlyArray<SubmissionLike>;
  now: number;
}): SubmissionEligibility {
  if (opts.task.status !== "active") return { ok: false, reason: "task_not_active" };
  if (opts.task.taskType !== "manual_review") return { ok: false, reason: "unsupported_task_type" };
  const startsAt = toMillis(opts.task.startsAt);
  const endsAt = toMillis(opts.task.endsAt);
  if (startsAt != null && opts.now < startsAt) return { ok: false, reason: "task_not_started" };
  if (endsAt != null && opts.now > endsAt) return { ok: false, reason: "task_ended" };
  const verified = opts.priorSubmissions.filter((s) => s.taskId === opts.task.id && s.status === "verified");
  if (opts.task.maxCompletionsPerUser === 1 && verified.length >= 1) {
    return { ok: false, reason: "already_completed" };
  }
  if (opts.task.maxCompletionsPerUser > 1 && verified.length >= opts.task.maxCompletionsPerUser) {
    return { ok: false, reason: "already_completed" };
  }
  return { ok: true };
}

function toMillis(d: Date | number | null | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  return d.getTime();
}

export interface ProofValidationInput {
  taskConfig: unknown;
  proofUrl?: string | null;
  hasScreenshot: boolean;
}

export type ProofValidationResult =
  | { ok: true }
  | { ok: false; field: "proofUrl" | "screenshot"; reason: string };

/**
 * Validate the submission's proof inputs against the task config. Re-parses
 * the taskConfig (CLAUDE.md § Task config validation: "never trust"). Run
 * at submit time AND at admin verify time.
 */
export function validateProofInputs(input: ProofValidationInput): ProofValidationResult {
  const cfg = parseManualReviewConfig(input.taskConfig);
  if (cfg.requiresProofUrl) {
    const url = (input.proofUrl ?? "").trim();
    if (!url) return { ok: false, field: "proofUrl", reason: "required" };
    if (!isHttpUrl(url)) return { ok: false, field: "proofUrl", reason: "must_be_https" };
  }
  if (cfg.requiresScreenshot && !input.hasScreenshot) {
    return { ok: false, field: "screenshot", reason: "required" };
  }
  return { ok: true };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Computes whether a slug edit is allowed for a project. Blocked if any
 * submission exists for any task under the project. Pure: caller queries
 * the count and passes it in.
 */
export function canEditProjectSlug(opts: { submissionCount: number }): boolean {
  return opts.submissionCount === 0;
}
