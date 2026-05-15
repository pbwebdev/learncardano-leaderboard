import { describe, expect, it } from "vitest";
import {
  ManualReviewConfigError,
  parseManualReviewConfig,
  verifyManualReview,
} from "./manual";

describe("verification/manual: parseManualReviewConfig", () => {
  it("accepts a valid config with proof URL required", () => {
    const cfg = parseManualReviewConfig({
      instructions: "Post a thread about Cardano",
      requiresProofUrl: true,
    });
    expect(cfg).toEqual({
      instructions: "Post a thread about Cardano",
      requiresProofUrl: true,
      requiresScreenshot: false,
    });
  });

  it("trims instructions whitespace", () => {
    const cfg = parseManualReviewConfig({
      instructions: "   tweet about us   ",
      requiresScreenshot: true,
    });
    expect(cfg.instructions).toBe("tweet about us");
  });

  it("rejects non-object input", () => {
    expect(() => parseManualReviewConfig(null)).toThrow(ManualReviewConfigError);
    expect(() => parseManualReviewConfig("string")).toThrow(ManualReviewConfigError);
    expect(() => parseManualReviewConfig(42)).toThrow(ManualReviewConfigError);
  });

  it("rejects missing or empty instructions", () => {
    expect(() => parseManualReviewConfig({ requiresProofUrl: true })).toThrow(/instructions/);
    expect(() => parseManualReviewConfig({ instructions: "   ", requiresProofUrl: true })).toThrow(/instructions/);
  });

  it("rejects when neither requiresProofUrl nor requiresScreenshot is true", () => {
    expect(() =>
      parseManualReviewConfig({ instructions: "do thing", requiresProofUrl: false, requiresScreenshot: false }),
    ).toThrow(/at least one/);
  });

  it("rejects non-boolean toggles", () => {
    expect(() =>
      parseManualReviewConfig({ instructions: "do thing", requiresProofUrl: "yes" }),
    ).toThrow(/requiresProofUrl/);
  });

  it("rejects instructions over 4000 chars", () => {
    expect(() =>
      parseManualReviewConfig({ instructions: "x".repeat(4001), requiresProofUrl: true }),
    ).toThrow(/max length/);
  });
});

describe("verification/manual: verifyManualReview", () => {
  const cfg = { instructions: "share a thread", requiresProofUrl: true, requiresScreenshot: false };

  it("returns needs_review when proof URL is present", () => {
    const r = verifyManualReview({
      taskConfig: cfg,
      submission: { proofUrl: "https://twitter.com/x/status/1" },
    });
    expect(r.status).toBe("needs_review");
  });

  it("rejects when required proof URL is missing", () => {
    const r = verifyManualReview({
      taskConfig: cfg,
      submission: { proofUrl: null },
    });
    expect(r).toEqual({ status: "rejected", reason: "missing_proof_url" });
  });

  it("rejects when required screenshot is missing", () => {
    const r = verifyManualReview({
      taskConfig: { instructions: "screenshot please", requiresScreenshot: true },
      submission: { proofR2Key: null },
    });
    expect(r).toEqual({ status: "rejected", reason: "missing_screenshot" });
  });

  it("returns needs_review when screenshot key is present", () => {
    const r = verifyManualReview({
      taskConfig: { instructions: "screenshot please", requiresScreenshot: true },
      submission: { proofR2Key: "submissions/stake1a/abc/proof.png" },
    });
    expect(r.status).toBe("needs_review");
  });

  it("re-parses taskConfig at verify time (defensive)", () => {
    expect(() =>
      verifyManualReview({ taskConfig: { instructions: "" }, submission: { proofUrl: "x" } }),
    ).toThrow(ManualReviewConfigError);
  });
});
