import { describe, expect, it } from "vitest";
import {
  BountyCompletionConfigError,
  computeBountyHmac,
  parseBountyCompletionConfig,
  verifyBountyCompletion,
  verifyBountyHmac,
} from "./bounty";
import { verify } from "./index";

describe("parseBountyCompletionConfig", () => {
  it("accepts a well-formed config", () => {
    expect(parseBountyCompletionConfig({ bountyId: "b1" })).toEqual({ bountyId: "b1" });
    // trims surrounding whitespace
    expect(parseBountyCompletionConfig({ bountyId: "  b2  " })).toEqual({ bountyId: "b2" });
  });

  it("rejects non-object input", () => {
    expect(() => parseBountyCompletionConfig(null)).toThrow(BountyCompletionConfigError);
    expect(() => parseBountyCompletionConfig("string")).toThrow(BountyCompletionConfigError);
    expect(() => parseBountyCompletionConfig(42)).toThrow(BountyCompletionConfigError);
  });

  it("rejects missing or empty bountyId", () => {
    expect(() => parseBountyCompletionConfig({})).toThrow(/bountyId/);
    expect(() => parseBountyCompletionConfig({ bountyId: "" })).toThrow(/bountyId/);
    expect(() => parseBountyCompletionConfig({ bountyId: "   " })).toThrow(/bountyId/);
    expect(() => parseBountyCompletionConfig({ bountyId: 1 })).toThrow(/bountyId/);
  });

  it("rejects too-long bountyId", () => {
    expect(() => parseBountyCompletionConfig({ bountyId: "x".repeat(257) })).toThrow(/max length/);
  });
});

describe("verifyBountyCompletion", () => {
  it("rejects with a webhook-only reason even on valid config", () => {
    const r = verifyBountyCompletion({ taskConfig: { bountyId: "b1" } });
    expect(r).toEqual({ status: "rejected", reason: "bounty_completion_is_webhook_only" });
  });

  it("surfaces config errors when reached via the queue path", () => {
    expect(() => verifyBountyCompletion({ taskConfig: { bountyId: "" } })).toThrow(BountyCompletionConfigError);
  });
});

describe("dispatcher routes bounty_completion to the verifier", () => {
  it("returns the rejected/webhook-only result", async () => {
    const r = await verify({
      taskType: "bounty_completion",
      taskConfig: { bountyId: "b1" },
      task: {},
      user: { stakeAddress: "stake1abc" },
      submission: {},
    });
    expect(r.status).toBe("rejected");
  });
});

describe("HMAC", () => {
  const SECRET = "test-secret-do-not-use-in-prod";

  it("computeBountyHmac produces a stable hex digest", async () => {
    const a = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000000);
    const b = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000000);
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes if any field changes", async () => {
    const base = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000000);
    const diffStake = await computeBountyHmac(SECRET, "stake1xyz", "b1", 1700000000);
    const diffBounty = await computeBountyHmac(SECRET, "stake1abc", "b2", 1700000000);
    const diffTs = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000001);
    const diffSecret = await computeBountyHmac("other-secret", "stake1abc", "b1", 1700000000);
    expect(new Set([base, diffStake, diffBounty, diffTs, diffSecret]).size).toBe(5);
  });

  it("verifyBountyHmac accepts the matching signature and rejects all others", async () => {
    const sig = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000000);
    expect(await verifyBountyHmac(SECRET, "stake1abc", "b1", 1700000000, sig)).toBe(true);
    // case insensitive
    expect(await verifyBountyHmac(SECRET, "stake1abc", "b1", 1700000000, sig.toUpperCase())).toBe(true);
    expect(await verifyBountyHmac(SECRET, "stake1abc", "b1", 1700000000, "deadbeef")).toBe(false);
    expect(await verifyBountyHmac(SECRET, "stake1abc", "b1", 1700000000, "")).toBe(false);
    // tamper
    const bad = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await verifyBountyHmac(SECRET, "stake1abc", "b1", 1700000000, bad)).toBe(false);
  });

  it("treats stringified completed_at consistently", async () => {
    const numSig = await computeBountyHmac(SECRET, "stake1abc", "b1", 1700000000);
    const strSig = await computeBountyHmac(SECRET, "stake1abc", "b1", "1700000000");
    // String coercion via template literal — both compute the same digest.
    expect(numSig).toEqual(strSig);
  });
});
