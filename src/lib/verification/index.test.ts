import { describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

vi.mock("@/lib/cardano", () => ({
  getAccountInfo: vi.fn(async () => null),
  getCurrentEpoch: vi.fn(async () => null),
  getDRepInfo: vi.fn(async () => null),
  getDRepVotes: vi.fn(async () => null),
  getTxInfo: vi.fn(async () => null),
}));

import { verify, isTaskTypeEnabledInPhase1, isTaskTypeEnabledInPhase2, ALL_TASK_TYPES } from "./index";

const STAKE = "stake1u9testaddress";

const baseOpts = (over: { taskType: string; taskConfig?: unknown; submission?: { txHash?: string } }) => ({
  taskType: over.taskType,
  taskConfig: over.taskConfig ?? {},
  task: { startsAt: null, endsAt: null },
  user: { stakeAddress: STAKE },
  submission: over.submission ?? {},
});

describe("verification dispatcher: phase 2 routing", () => {
  it("dispatches manual_review to its verifier and returns needs_review", async () => {
    const r = await verify({
      ...baseOpts({ taskType: "manual_review" }),
      taskConfig: { instructions: "post a thread", requiresProofUrl: true },
      submission: { proofUrl: "https://x.com/post/1" },
    });
    expect(r.status).toBe("needs_review");
  });

  it("routes phase 2 on-chain types into their verifiers (returns a VerifierResult)", async () => {
    const phase2 = ["pool_delegation", "drep_delegation", "drep_registered", "governance_vote"];
    for (const t of phase2) {
      const r = await verify(baseOpts({ taskType: t }));
      // With mocks returning null, every verifier should produce a result
      // (most yield needs_review on upstream-unavailable; tx-hash returns
      // rejected for the empty hash). Either way: no throw, no string return.
      expect(["verified", "rejected", "needs_review"]).toContain(r.status);
    }
  });

  it("routes tx_swap / asset_purchase to tx-hash verifier", async () => {
    const r1 = await verify(baseOpts({ taskType: "tx_swap", submission: { txHash: "" } }));
    expect(r1.status).toBe("rejected");
    expect((r1 as { reason: string }).reason).toBe("invalid_tx_hash");
    const r2 = await verify(baseOpts({ taskType: "asset_purchase", submission: { txHash: "abc" } }));
    expect(r2.status).toBe("rejected");
  });

  it("throws unknown_task_type for phase 3+ types", async () => {
    for (const t of ["x_tweet", "x_retweet", "youtube_comment", "bounty_completion"]) {
      await expect(verify(baseOpts({ taskType: t }))).rejects.toThrow(/unknown_task_type/);
    }
  });

  it("throws unknown_task_type for completely unknown discriminators", async () => {
    await expect(
      verify(baseOpts({ taskType: "not_a_real_type" })),
    ).rejects.toThrow("unknown_task_type:not_a_real_type");
  });

  it("isTaskTypeEnabledInPhase2 covers manual_review + 6 phase 2 types", () => {
    const enabled = ALL_TASK_TYPES.filter((t) => isTaskTypeEnabledInPhase2(t));
    expect(enabled).toEqual([
      "manual_review",
      "pool_delegation",
      "drep_delegation",
      "drep_registered",
      "tx_swap",
      "asset_purchase",
      "governance_vote",
    ]);
    expect(isTaskTypeEnabledInPhase1("manual_review")).toBe(true);
    expect(isTaskTypeEnabledInPhase1("pool_delegation")).toBe(false);
  });
});
