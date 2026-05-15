import { describe, expect, it } from "vitest";
import {
  canSubmitForTask,
  validateProofInputs,
  canEditProjectSlug,
  type TaskLike,
} from "./submissions";

const NOW = 1_700_000_000_000;

function makeTask(over: Partial<TaskLike> = {}): TaskLike {
  return {
    id: "t1",
    status: "active",
    startsAt: null,
    endsAt: null,
    maxCompletionsPerUser: 1,
    taskType: "manual_review",
    taskConfig: { instructions: "x", requiresProofUrl: true },
    ...over,
  };
}

describe("submissions: canSubmitForTask eligibility", () => {
  it("allows submission for an active task with no prior verified completion", () => {
    expect(canSubmitForTask({ task: makeTask(), priorSubmissions: [], now: NOW })).toEqual({ ok: true });
  });

  it("blocks when task status is not active", () => {
    const r = canSubmitForTask({ task: makeTask({ status: "draft" }), priorSubmissions: [], now: NOW });
    expect(r).toEqual({ ok: false, reason: "task_not_active" });
  });

  it("blocks when task hasn't started", () => {
    const r = canSubmitForTask({ task: makeTask({ startsAt: NOW + 1000 }), priorSubmissions: [], now: NOW });
    expect(r).toEqual({ ok: false, reason: "task_not_started" });
  });

  it("blocks when task has ended", () => {
    const r = canSubmitForTask({ task: makeTask({ endsAt: NOW - 1000 }), priorSubmissions: [], now: NOW });
    expect(r).toEqual({ ok: false, reason: "task_ended" });
  });

  it("blocks a second submission when max=1, regardless of prior status (verified)", () => {
    const r = canSubmitForTask({
      task: makeTask(),
      priorSubmissions: [{ userId: "u", taskId: "t1", status: "verified" }],
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "already_submitted" });
  });

  it("blocks a second submission when max=1 even if the prior is still pending", () => {
    const r = canSubmitForTask({
      task: makeTask(),
      priorSubmissions: [{ userId: "u", taskId: "t1", status: "pending" }],
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "already_submitted" });
  });

  it("blocks a second submission when max=1 even if the prior was rejected (anti-spam)", () => {
    const r = canSubmitForTask({
      task: makeTask(),
      priorSubmissions: [{ userId: "u", taskId: "t1", status: "rejected" }],
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "already_submitted" });
  });

  it("submissions on a DIFFERENT task do not block this one", () => {
    const r = canSubmitForTask({
      task: makeTask(),
      priorSubmissions: [{ userId: "u", taskId: "other-task", status: "rejected" }],
      now: NOW,
    });
    expect(r).toEqual({ ok: true });
  });

  it("allows Phase 2 on-chain task types", () => {
    const r = canSubmitForTask({
      task: makeTask({ taskType: "pool_delegation", taskConfig: {} }),
      priorSubmissions: [],
      now: NOW,
    });
    expect(r).toEqual({ ok: true });
  });

  it("allows Phase 3 OAuth task types", () => {
    // x_tweet / x_retweet / youtube_comment are submission-driven in Phase 3.
    for (const t of ["x_tweet", "x_retweet", "youtube_comment"]) {
      const r = canSubmitForTask({
        task: makeTask({ taskType: t, taskConfig: {} }),
        priorSubmissions: [],
        now: NOW,
      });
      expect(r).toEqual({ ok: true });
    }
  });

  it("blocks Phase 4+ webhook-only task types as unsupported", () => {
    const r = canSubmitForTask({
      task: makeTask({ taskType: "bounty_completion", taskConfig: {} }),
      priorSubmissions: [],
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "unsupported_task_type" });
  });

  it("respects maxCompletionsPerUser > 1", () => {
    const ok = canSubmitForTask({
      task: makeTask({ maxCompletionsPerUser: 3 }),
      priorSubmissions: [
        { userId: "u", taskId: "t1", status: "verified" },
        { userId: "u", taskId: "t1", status: "verified" },
      ],
      now: NOW,
    });
    expect(ok).toEqual({ ok: true });
    const blocked = canSubmitForTask({
      task: makeTask({ maxCompletionsPerUser: 2 }),
      priorSubmissions: [
        { userId: "u", taskId: "t1", status: "verified" },
        { userId: "u", taskId: "t1", status: "verified" },
      ],
      now: NOW,
    });
    expect(blocked).toEqual({ ok: false, reason: "already_completed" });
  });
});

describe("submissions: validateProofInputs", () => {
  const cfgUrlOnly = { instructions: "x", requiresProofUrl: true, requiresScreenshot: false };
  const cfgBoth = { instructions: "x", requiresProofUrl: true, requiresScreenshot: true };

  it("accepts a valid https proof URL", () => {
    expect(validateProofInputs({ taskConfig: cfgUrlOnly, proofUrl: "https://x.com/post/1", hasScreenshot: false })).toEqual({ ok: true });
  });

  it("rejects a missing required proof URL", () => {
    expect(validateProofInputs({ taskConfig: cfgUrlOnly, proofUrl: "", hasScreenshot: false })).toEqual({
      ok: false,
      field: "proofUrl",
      reason: "required",
    });
  });

  it("rejects non-http(s) URLs", () => {
    expect(
      validateProofInputs({ taskConfig: cfgUrlOnly, proofUrl: "javascript:alert(1)", hasScreenshot: false }),
    ).toEqual({ ok: false, field: "proofUrl", reason: "must_be_https" });
    expect(
      validateProofInputs({ taskConfig: cfgUrlOnly, proofUrl: "not a url", hasScreenshot: false }),
    ).toEqual({ ok: false, field: "proofUrl", reason: "must_be_https" });
  });

  it("requires a screenshot when configured", () => {
    expect(
      validateProofInputs({ taskConfig: cfgBoth, proofUrl: "https://x.com/1", hasScreenshot: false }),
    ).toEqual({ ok: false, field: "screenshot", reason: "required" });
  });

  it("accepts screenshot + URL when both required", () => {
    expect(
      validateProofInputs({ taskConfig: cfgBoth, proofUrl: "https://x.com/1", hasScreenshot: true }),
    ).toEqual({ ok: true });
  });

  it("re-parses bad config and throws", () => {
    expect(() =>
      validateProofInputs({ taskConfig: { instructions: "" }, proofUrl: "x", hasScreenshot: false }),
    ).toThrow();
  });
});

describe("submissions: canEditProjectSlug", () => {
  it("allows edit when no submissions exist", () => {
    expect(canEditProjectSlug({ submissionCount: 0 })).toBe(true);
  });
  it("blocks edit once any submission exists", () => {
    expect(canEditProjectSlug({ submissionCount: 1 })).toBe(false);
  });
});
