import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/cardano", () => ({
  getAccountInfo: vi.fn(),
  getDRepVotes: vi.fn(),
}));

import { getAccountInfo, getDRepVotes } from "@/lib/cardano";
import {
  parseGovernanceVoteConfig,
  verifyGovernanceVote,
  GovernanceConfigError,
} from "./governance";

const STAKE = "stake1u9testaddress";
const DREP = "drep1abcdefg0123456789abcdef0123456789abcdef0123456789a";
const ACTION = "b".repeat(64);

const ACC = {
  stake_address: STAKE,
  total_balance: "0",
  rewards_available: "0",
  delegated_pool: null,
  delegated_drep: DREP,
  registered: true,
};

beforeEach(() => vi.clearAllMocks());

describe("verification/governance: parseGovernanceVoteConfig", () => {
  it("accepts empty config", () => {
    expect(parseGovernanceVoteConfig({})).toEqual({ actionTxHash: null });
  });
  it("accepts a valid 64-hex actionTxHash", () => {
    expect(parseGovernanceVoteConfig({ actionTxHash: ACTION })).toEqual({ actionTxHash: ACTION });
  });
  it("rejects malformed actionTxHash", () => {
    expect(() => parseGovernanceVoteConfig({ actionTxHash: "short" })).toThrow(GovernanceConfigError);
  });
});

describe("verification/governance: verifyGovernanceVote", () => {
  it("rejected when user isn't delegated to a DRep", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACC, delegated_drep: null });
    const r = await verifyGovernanceVote({ taskConfig: {}, task: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "not_delegated_to_a_drep" });
  });

  it("rejected when delegated to a key DRep", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACC, delegated_drep: "drep_always_abstain" });
    const r = await verifyGovernanceVote({ taskConfig: {}, task: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "delegated_to_key_drep" });
  });

  it("verified when DRep voted on the configured action", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    (getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { proposal_tx_hash: ACTION, proposal_index: 0, vote: "yes", block_time: null },
    ]);
    const r = await verifyGovernanceVote({
      taskConfig: { actionTxHash: ACTION },
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when DRep voted but not on the configured action", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    (getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { proposal_tx_hash: "c".repeat(64), proposal_index: 0, vote: "yes", block_time: null },
    ]);
    const r = await verifyGovernanceVote({
      taskConfig: { actionTxHash: ACTION },
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "drep_did_not_vote_on_action" });
  });

  it("verified for any vote in window when no specific action configured", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    (getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { proposal_tx_hash: ACTION, proposal_index: 0, vote: "yes", block_time: 1_700_000_500 },
    ]);
    const r = await verifyGovernanceVote({
      taskConfig: {},
      task: { startsAt: 1_700_000_000 * 1000, endsAt: 1_700_001_000 * 1000 },
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review when vote list is unavailable", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    (getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyGovernanceVote({ taskConfig: {}, task: {}, user: { stakeAddress: STAKE } });
    expect(r.status).toBe("needs_review");
  });

  it("rejected when DRep has zero votes", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    (getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const r = await verifyGovernanceVote({ taskConfig: {}, task: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "drep_has_not_voted" });
  });
});
