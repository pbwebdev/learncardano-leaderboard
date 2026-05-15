import { verifyManualReview, type VerifierResult } from "./manual";
import { verifyDelegation } from "./delegation";
import { verifyDRepRegistered } from "./drep-activity";
import { verifyTxHash } from "./tx-hash";
import { verifyGovernanceVote } from "./governance";
import { verifyXRetweet, verifyXTweet } from "./social-x";

/**
 * Verification dispatcher — reads `task.taskType`, routes to the right
 * verifier, returns a `VerifierResult`.
 *
 * Phase 2 enables the six on-chain types. Phase 3/4 will add the OAuth +
 * webhook verifiers (x_tweet, x_retweet, youtube_comment, bounty_completion).
 *
 * The dispatcher is intentionally NOT typed against `TaskType` directly —
 * `task.taskType` is a free string in D1, and the dispatcher's job is to
 * surface "unknown_task_type:..." errors clearly when the value doesn't
 * match. Wrap-and-re-throw at the queue consumer level.
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

const PHASE2_AUTO_TYPES: TaskType[] = [
  "pool_delegation",
  "drep_delegation",
  "drep_registered",
  "tx_swap",
  "asset_purchase",
  "governance_vote",
];

const PHASE3_TYPES: TaskType[] = ["x_tweet", "x_retweet", "youtube_comment"];

// Phase 4: bounty_completion is a webhook-driven path, not a submission flow.
const PHASE4_PLUS_TYPES: TaskType[] = ["bounty_completion"];

/** True when a user can submit for this task type via the standard flow. */
export function isTaskTypeEnabledInPhase2(t: string): boolean {
  return t === "manual_review" || (PHASE2_AUTO_TYPES as string[]).includes(t);
}

/** Legacy alias kept for the Phase 1 admin UI / tests. */
export function isTaskTypeEnabledInPhase1(t: string): boolean {
  return t === "manual_review";
}

/** Phase 3: submission-driven OAuth verifiers (X, YouTube). */
export function isTaskTypeEnabledInPhase3(t: string): boolean {
  return isTaskTypeEnabledInPhase2(t) || (PHASE3_TYPES as string[]).includes(t);
}

/**
 * Legacy name retained for callers — now means "phase 4+ webhook-only
 * types we don't accept submissions for". Previously this included
 * the X/YouTube types; Phase 3 lights them up via the dispatcher.
 */
export function isPhase3PlusTaskType(t: string): boolean {
  return (PHASE4_PLUS_TYPES as string[]).includes(t);
}

export type { VerifierResult } from "./manual";

/**
 * Verifier dispatch surface. Phase 1 only needed `taskType` + `taskConfig`
 * + `submission`. Phase 2 verifiers also need the task's start time (for
 * tx-age guards) and the user's stake address (for ownership checks).
 */
export interface VerifyOpts {
  taskType: string;
  taskConfig: unknown;
  task: { startsAt?: Date | number | null; endsAt?: Date | number | null };
  user: {
    stakeAddress: string;
    // Phase 3 OAuth fields — populated by the queue consumer when the
    // task type needs them. Verifiers tolerate null/undefined and
    // return needs_review with a specific reason.
    xUserId?: string | null;
    xAccessTokenEnc?: string | null;
    youtubeChannelId?: string | null;
    youtubeAccessTokenEnc?: string | null;
  };
  submission: { proofUrl?: string | null; proofR2Key?: string | null; txHash?: string | null };
}

export async function verify(opts: VerifyOpts): Promise<VerifierResult> {
  switch (opts.taskType) {
    case "manual_review":
      return verifyManualReview({ taskConfig: opts.taskConfig, submission: opts.submission });
    case "pool_delegation":
    case "drep_delegation":
      return verifyDelegation({
        taskType: opts.taskType,
        taskConfig: opts.taskConfig,
        task: opts.task,
        user: opts.user,
      });
    case "drep_registered":
      return verifyDRepRegistered({ taskConfig: opts.taskConfig, user: opts.user });
    case "tx_swap":
    case "asset_purchase":
      return verifyTxHash({
        taskType: opts.taskType,
        taskConfig: opts.taskConfig,
        task: opts.task,
        user: opts.user,
        submission: opts.submission,
      });
    case "governance_vote":
      return verifyGovernanceVote({
        taskConfig: opts.taskConfig,
        task: opts.task,
        user: opts.user,
      });
    case "x_tweet":
      return verifyXTweet({
        taskConfig: opts.taskConfig,
        task: opts.task,
        user: {
          stakeAddress: opts.user.stakeAddress,
          xUserId: opts.user.xUserId,
          xAccessTokenEnc: opts.user.xAccessTokenEnc,
        },
        submission: opts.submission,
      });
    case "x_retweet":
      return verifyXRetweet({
        taskConfig: opts.taskConfig,
        task: opts.task,
        user: {
          stakeAddress: opts.user.stakeAddress,
          xUserId: opts.user.xUserId,
          xAccessTokenEnc: opts.user.xAccessTokenEnc,
        },
      });
    case "youtube_comment":
      // YouTube verifier wired in the next commit.
      throw new Error(`unknown_task_type:${opts.taskType}:phase3_pending`);
    case "bounty_completion":
      throw new Error(`unknown_task_type:${opts.taskType}:phase4`);
    default:
      throw new Error(`unknown_task_type:${opts.taskType}`);
  }
}
