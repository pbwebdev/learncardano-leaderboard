/**
 * Manual review verifier.
 *
 * No on-chain or OAuth checks — submission lands in admin queue with
 * `status='pending'`. Admin approve/reject is the verifier (see
 * `src/app/admin/submissions/[id]/actions.ts`).
 *
 * Phase 1 ships this verifier only. The dispatcher in ./index.ts throws
 * `unknown_task_type` for every other taskType until Phase 2.
 *
 * `taskConfig` shape:
 *   { instructions: string,
 *     requiresProofUrl?: boolean,
 *     requiresScreenshot?: boolean }
 *
 * Parsed via `parseManualReviewConfig` — hand-rolled, no `zod` dep
 * (Phase 1 constraint). Re-parse at every read (save AND verify time)
 * since `tasks.taskConfig` is a JSON blob and we don't trust the admin
 * UI to keep shape valid.
 */

export interface ManualReviewConfig {
  instructions: string;
  requiresProofUrl: boolean;
  requiresScreenshot: boolean;
}

export class ManualReviewConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`manual_review_config:${field}:${message}`);
    this.name = "ManualReviewConfigError";
    this.field = field;
  }
}

/**
 * Parse an unknown JSON blob into a validated ManualReviewConfig. Throws
 * `ManualReviewConfigError` with a per-field message for the admin UI to
 * surface.
 */
export function parseManualReviewConfig(raw: unknown): ManualReviewConfig {
  if (raw == null || typeof raw !== "object") {
    throw new ManualReviewConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const instructions = obj.instructions;
  if (typeof instructions !== "string" || instructions.trim().length === 0) {
    throw new ManualReviewConfigError("instructions", "required, non-empty string");
  }
  if (instructions.length > 4000) {
    throw new ManualReviewConfigError("instructions", "max length 4000");
  }
  const requiresProofUrl = coerceBool(obj.requiresProofUrl, false, "requiresProofUrl");
  const requiresScreenshot = coerceBool(obj.requiresScreenshot, false, "requiresScreenshot");
  if (!requiresProofUrl && !requiresScreenshot) {
    // Without either, a user can submit nothing — defeats the point of
    // a manual review task. Admin UI surfaces this.
    throw new ManualReviewConfigError("root", "at least one of requiresProofUrl/requiresScreenshot must be true");
  }
  return { instructions: instructions.trim(), requiresProofUrl, requiresScreenshot };
}

function coerceBool(v: unknown, fallback: boolean, field: string): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === 1 || v === 0) return Boolean(v);
  throw new ManualReviewConfigError(field, "must be boolean");
}

/**
 * Verifier surface for the manual review task type. Manual review never
 * auto-passes — the verifier returns `needs_review` regardless of inputs
 * (admin queue picks it up). Returning a discriminated result matches
 * the contract every other verifier will follow in Phase 2.
 */
export type VerifierResult =
  | { status: "verified"; reason?: string }
  | { status: "rejected"; reason: string }
  | { status: "needs_review"; reason?: string };

export function verifyManualReview(opts: {
  taskConfig: unknown;
  submission: { proofUrl?: string | null; proofR2Key?: string | null };
}): VerifierResult {
  const cfg = parseManualReviewConfig(opts.taskConfig);
  // Pre-flight: refuse if the submission doesn't include what the task
  // requires. Admin queue should never see a submission missing required
  // proof — caller (the submission action) enforces this too, but the
  // verifier double-checks (defence in depth).
  if (cfg.requiresProofUrl && !opts.submission.proofUrl) {
    return { status: "rejected", reason: "missing_proof_url" };
  }
  if (cfg.requiresScreenshot && !opts.submission.proofR2Key) {
    return { status: "rejected", reason: "missing_screenshot" };
  }
  return { status: "needs_review", reason: "awaiting_admin_review" };
}
