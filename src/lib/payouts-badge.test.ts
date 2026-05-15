import { describe, expect, it } from "vitest";
import { shouldShowPayoutsVerifiedBadge } from "./payouts-badge";

describe("shouldShowPayoutsVerifiedBadge", () => {
  it("hides when no batches exist", () => {
    expect(shouldShowPayoutsVerifiedBadge({ total: 0, verified: 0 })).toBe(false);
  });

  it("hides when at least one batch is unverified", () => {
    expect(shouldShowPayoutsVerifiedBadge({ total: 3, verified: 2 })).toBe(false);
    expect(shouldShowPayoutsVerifiedBadge({ total: 1, verified: 0 })).toBe(false);
  });

  it("shows when every batch is verified", () => {
    expect(shouldShowPayoutsVerifiedBadge({ total: 1, verified: 1 })).toBe(true);
    expect(shouldShowPayoutsVerifiedBadge({ total: 5, verified: 5 })).toBe(true);
  });
});
