import { describe, expect, it } from "vitest";
import { verify, isTaskTypeEnabledInPhase1, ALL_TASK_TYPES } from "./index";

describe("verification dispatcher: phase 1 routing", () => {
  it("dispatches manual_review to its verifier and returns needs_review", async () => {
    const r = await verify({
      taskType: "manual_review",
      taskConfig: { instructions: "post a thread", requiresProofUrl: true },
      submission: { proofUrl: "https://x.com/post/1" },
    });
    expect(r.status).toBe("needs_review");
  });

  it("throws unknown_task_type for every non-manual recognised type (phase 2)", async () => {
    const phase2 = ALL_TASK_TYPES.filter((t) => t !== "manual_review");
    for (const t of phase2) {
      await expect(
        verify({ taskType: t, taskConfig: {}, submission: {} }),
      ).rejects.toThrow(/unknown_task_type/);
    }
  });

  it("throws unknown_task_type for completely unknown discriminators", async () => {
    await expect(
      verify({ taskType: "not_a_real_type", taskConfig: {}, submission: {} }),
    ).rejects.toThrow("unknown_task_type:not_a_real_type");
  });

  it("isTaskTypeEnabledInPhase1 returns true only for manual_review", () => {
    expect(isTaskTypeEnabledInPhase1("manual_review")).toBe(true);
    for (const t of ALL_TASK_TYPES.filter((x) => x !== "manual_review")) {
      expect(isTaskTypeEnabledInPhase1(t)).toBe(false);
    }
  });
});
