import { verifyManualReview, type VerifierResult } from "./manual";

/**
 * Verification dispatcher — reads `task.taskType`, routes to the right
 * verifier, returns a `VerifierResult`.
 *
 * Phase 1 ships `manual_review` only. Every other type listed in
 * docs/task-types.md is recognised so the admin UI can show all 10 in
 * the dropdown, but `verify()` throws `unknown_task_type` for them
 * until Phase 2 lands the auto verifiers.
 */

export type TaskType =
  | "manual_review"
  | "pool_delegation"
  | "drep_delegation"
  | "drep_registered"
  | "tx_swap"
  | "asset_purchase"
  | "governance_vote"
  | "x_tweet"
  | "x_retweet"
  | "youtube_comment"
  | "bounty_completion";

export const ALL_TASK_TYPES: TaskType[] = [
  "manual_review",
  "pool_delegation",
  "drep_delegation",
  "drep_registered",
  "tx_swap",
  "asset_purchase",
  "governance_vote",
  "x_tweet",
  "x_retweet",
  "youtube_comment",
  "bounty_completion",
];

/**
 * Which task types are usable in this phase. The admin UI greys out
 * disabled types in the dropdown — see /admin/tasks/new.
 */
export function isTaskTypeEnabledInPhase1(t: TaskType): boolean {
  return t === "manual_review";
}

export type { VerifierResult } from "./manual";

export async function verify(opts: {
  taskType: string;
  taskConfig: unknown;
  submission: { proofUrl?: string | null; proofR2Key?: string | null; txHash?: string | null };
}): Promise<VerifierResult> {
  switch (opts.taskType) {
    case "manual_review":
      return verifyManualReview(opts);
    case "pool_delegation":
    case "drep_delegation":
    case "drep_registered":
    case "tx_swap":
    case "asset_purchase":
    case "governance_vote":
    case "x_tweet":
    case "x_retweet":
    case "youtube_comment":
    case "bounty_completion":
      throw new Error(`unknown_task_type:${opts.taskType}:phase2`);
    default:
      throw new Error(`unknown_task_type:${opts.taskType}`);
  }
}
