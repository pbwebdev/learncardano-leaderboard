/**
 * `governance_vote` verifier.
 *
 * Confirm the user has delegated to a DRep, then confirm that DRep has voted
 * on the specified governance action (or any action within the task window
 * if `actionTxHash` is unconfigured).
 *
 * Note: the verifier credits a user when *their delegated DRep* votes, not
 * when the user themselves casts a vote — Cardano voting is currently
 * delegate-only for non-SPO citizens, so this is the right grain. When DReps
 * are individuals (the user IS a DRep registered to themselves), the
 * `drep_registered` + `governance_vote` combo covers the "I voted" case.
 */

import { getAccountInfo, getDRepVotes } from "@/lib/cardano";
import type { VerifierResult } from "./manual";

const TX_HASH_RE = /^[0-9a-f]{64}$/;

export interface GovernanceVoteConfig {
  actionTxHash: string | null;
}

export class GovernanceConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`governance_config:${field}:${message}`);
    this.name = "GovernanceConfigError";
    this.field = field;
  }
}

export function parseGovernanceVoteConfig(raw: unknown): GovernanceVoteConfig {
  if (raw == null || typeof raw !== "object") {
    return { actionTxHash: null };
  }
  const obj = raw as Record<string, unknown>;
  let actionTxHash: string | null = null;
  if (obj.actionTxHash !== undefined && obj.actionTxHash !== null && obj.actionTxHash !== "") {
    if (typeof obj.actionTxHash !== "string" || !TX_HASH_RE.test(obj.actionTxHash)) {
      throw new GovernanceConfigError("actionTxHash", "must be a 64-char hex tx hash");
    }
    actionTxHash = obj.actionTxHash;
  }
  return { actionTxHash };
}

export interface GovernanceVerifyOpts {
  taskConfig: unknown;
  task: { startsAt?: Date | number | null; endsAt?: Date | number | null };
  user: { stakeAddress: string };
}

export async function verifyGovernanceVote(opts: GovernanceVerifyOpts): Promise<VerifierResult> {
  const cfg = parseGovernanceVoteConfig(opts.taskConfig);
  const account = await getAccountInfo(opts.user.stakeAddress);
  if (!account) return { status: "needs_review", reason: "account_info_unavailable" };
  if (!account.delegated_drep) {
    return { status: "rejected", reason: "not_delegated_to_a_drep" };
  }
  if (account.delegated_drep === "drep_always_abstain" || account.delegated_drep === "drep_always_no_confidence") {
    return { status: "rejected", reason: "delegated_to_key_drep" };
  }

  const votes = await getDRepVotes(account.delegated_drep);
  if (votes == null) return { status: "needs_review", reason: "drep_votes_unavailable" };
  if (votes.length === 0) return { status: "rejected", reason: "drep_has_not_voted" };

  if (cfg.actionTxHash) {
    const match = votes.find((v) => v.proposal_tx_hash === cfg.actionTxHash);
    if (!match) return { status: "rejected", reason: "drep_did_not_vote_on_action" };
    return { status: "verified" };
  }

  // No specific action — any vote within [startsAt, endsAt] counts.
  // Providers may not surface block_time on vote rows; when missing, accept
  // the presence of any vote at all (matches the docs/task-types.md spec
  // "or any vote within task window if unconfigured").
  const startMs = toMillis(opts.task.startsAt);
  const endMs = toMillis(opts.task.endsAt);
  const inWindow = votes.some((v) => {
    if (v.block_time == null) return true; // benefit of the doubt
    const t = v.block_time * 1000;
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  });
  return inWindow
    ? { status: "verified" }
    : { status: "rejected", reason: "drep_vote_outside_window" };
}

function toMillis(d: Date | number | null | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  return d.getTime();
}
