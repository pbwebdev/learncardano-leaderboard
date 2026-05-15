/**
 * Pure-logic helpers for submission server actions. These are split out
 * of the action handlers so they can be unit-tested without a DB.
 *
 * Used by /projects/[slug]/tasks/[taskId]/submit/actions.ts and the
 * admin approve/reject actions.
 */

import { parseManualReviewConfig } from "./verification/manual";
import { isPhase3PlusTaskType, isTaskTypeEnabledInPhase2 } from "./verification";

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
  | { ok: false; reason: "task_not_active" | "task_not_started" | "task_ended" | "already_submitted" | "already_completed" | "unsupported_task_type" };

/**
 * Eligibility check before a user submits. Pure: takes the task + their
 * prior submissions and returns a discriminated result.
 *
 * Rules:
 *   - task.status must be 'active'
 *   - now must be within [startsAt, endsAt] when set
 *   - One submission per user per task, full stop — ANY prior submission
 *     (pending, verified, rejected, paid, reward_verified) for this task
 *     blocks a new one. This is the manual-review anti-spam: without it,
 *     a user can keep resubmitting after every rejection hoping for a
 *     different admin call.
 *   - If a user legitimately needs a retry, an admin can delete the
 *     rejected submission row from D1 to free the slot (admin self-serve
 *     reset flow is a Phase 4+ enhancement, not v1).
 *   - maxCompletionsPerUser > 1 still works on the verified-count axis
 *     for tasks where repeats are intentional (e.g. a daily check-in
 *     task in a later phase).
 *   - Phase 1: only manual_review is allowed; other types return
 *     unsupported_task_type
 */
export function canSubmitForTask(opts: {
  task: TaskLike;
  priorSubmissions: ReadonlyArray<SubmissionLike>;
  now: number;
}): SubmissionEligibility {
  if (opts.task.status !== "active") return { ok: false, reason: "task_not_active" };
  // Phase 2 enables six on-chain types alongside manual_review. Phase 3+
  // OAuth / webhook types still come through this path eventually, but
  // require additional plumbing — gate them off for now.
  if (isPhase3PlusTaskType(opts.task.taskType)) {
    return { ok: false, reason: "unsupported_task_type" };
  }
  if (!isTaskTypeEnabledInPhase2(opts.task.taskType)) {
    return { ok: false, reason: "unsupported_task_type" };
  }
  const startsAt = toMillis(opts.task.startsAt);
  const endsAt = toMillis(opts.task.endsAt);
  if (startsAt != null && opts.now < startsAt) return { ok: false, reason: "task_not_started" };
  if (endsAt != null && opts.now > endsAt) return { ok: false, reason: "task_ended" };
  const mineForTask = opts.priorSubmissions.filter((s) => s.taskId === opts.task.id);
  if (opts.task.maxCompletionsPerUser === 1 && mineForTask.length >= 1) {
    return { ok: false, reason: "already_submitted" };
  }
  const verified = mineForTask.filter((s) => s.status === "verified");
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
  taskType?: string;
  taskConfig: unknown;
  proofUrl?: string | null;
  hasScreenshot: boolean;
  txHash?: string | null;
}

export type ProofValidationResult =
  | { ok: true }
  | { ok: false; field: "proofUrl" | "screenshot" | "txHash"; reason: string };

const TX_HASH_RE = /^[0-9a-f]{64}$/;

const ON_CHAIN_TASK_TYPES = new Set([
  "pool_delegation",
  "drep_delegation",
  "drep_registered",
  "tx_swap",
  "asset_purchase",
  "governance_vote",
]);

const TX_HASH_REQUIRED_TYPES = new Set(["tx_swap", "asset_purchase"]);

/**
 * Validate the submission's proof inputs against the task type + config.
 *
 *  - manual_review: re-parse the manual config, enforce proofUrl/screenshot.
 *  - tx_swap / asset_purchase: require a well-formed tx hash.
 *  - pool_delegation / drep_delegation / drep_registered / governance_vote:
 *    no proof from the user — the verifier reads on-chain state directly.
 *
 * Run at submit time AND at admin re-verify time. Re-parses any task config
 * touched (CLAUDE.md § Task config validation: "never trust").
 */
export function validateProofInputs(input: ProofValidationInput): ProofValidationResult {
  const taskType = input.taskType ?? "manual_review";
  if (TX_HASH_REQUIRED_TYPES.has(taskType)) {
    const tx = (input.txHash ?? "").trim().toLowerCase();
    if (!tx) return { ok: false, field: "txHash", reason: "required" };
    if (!TX_HASH_RE.test(tx)) return { ok: false, field: "txHash", reason: "invalid_hash" };
    return { ok: true };
  }
  if (ON_CHAIN_TASK_TYPES.has(taskType)) {
    // No user-supplied proof required.
    return { ok: true };
  }
  // manual_review (and the legacy default path).
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
