import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      AUTH_SESSION_SECRET: "test-secret-do-not-use-in-prod-0123456789abcdef",
      X_CLIENT_ID: "test-x-client",
      X_CLIENT_SECRET: "test-x-secret",
    },
  }),
}));

// We mock the X client at the function boundary — same pattern the
// on-chain verifier tests use for the Cardano facade.
vi.mock("@/lib/oauth/x", async () => {
  const actual = await vi.importActual<typeof import("@/lib/oauth/x")>("@/lib/oauth/x");
  return {
    ...actual,
    getTweetById: vi.fn(),
    getUserRetweets: vi.fn(),
    isXConfigured: vi.fn(() => true),
  };
});

import { encryptString } from "@/lib/crypto";
import * as xClient from "@/lib/oauth/x";
import {
  parseXTweetConfig,
  parseXRetweetConfig,
  tweetTextContainsAll,
  verifyXRetweet,
  verifyXTweet,
} from "./social-x";

let accessTokenEnc: string;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(xClient.isXConfigured).mockReturnValue(true);
  accessTokenEnc = await encryptString("fake-access-token");
});
afterEach(() => vi.resetAllMocks());

describe("parseXTweetConfig", () => {
  it("lower-cases and strips # / @ prefixes", () => {
    const cfg = parseXTweetConfig({
      requiredHashtags: ["#Cardano", "ADA"],
      requiredMentions: ["@LearnCardano", "Peter"],
    });
    expect(cfg.requiredHashtags).toEqual(["cardano", "ada"]);
    expect(cfg.requiredMentions).toEqual(["learncardano", "peter"]);
  });
  it("treats missing arrays as empty", () => {
    expect(parseXTweetConfig({})).toEqual({ requiredHashtags: [], requiredMentions: [] });
  });
});

describe("parseXRetweetConfig", () => {
  it("requires a numeric ID string", () => {
    expect(parseXRetweetConfig({ targetTweetId: "1234567890" })).toEqual({
      targetTweetId: "1234567890",
    });
    expect(() => parseXRetweetConfig({ targetTweetId: "abc" })).toThrow();
    expect(() => parseXRetweetConfig({})).toThrow();
  });
});

describe("tweetTextContainsAll", () => {
  it("matches case-insensitively", () => {
    expect(tweetTextContainsAll("loving #CARDANO today", ["#cardano"])).toEqual({ ok: true });
  });
  it("reports the first missing token", () => {
    const r = tweetTextContainsAll("nothing relevant", ["#cardano", "#ada"]);
    expect(r).toEqual({ ok: false, missing: "#cardano" });
  });
});

describe("verifyXTweet", () => {
  const baseTask = { startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: null };
  const user = {
    stakeAddress: "stake1xyz",
    xUserId: "111",
    xAccessTokenEnc: "", // set per-test
  };

  it("returns needs_review:no_x_account when xUserId missing", async () => {
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: ["#cardano"], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xUserId: null, xAccessTokenEnc: null },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r.status).toBe("needs_review");
    expect(r.reason).toBe("no_x_account");
  });

  it("returns needs_review:oauth_not_configured when isXConfigured is false", async () => {
    vi.mocked(xClient.isXConfigured).mockReturnValueOnce(false);
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: [], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r.status).toBe("needs_review");
    expect(r.reason).toBe("oauth_not_configured");
  });

  it("rejects when proof URL is missing", async () => {
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: [], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "" },
    });
    expect(r).toEqual({ status: "rejected", reason: "missing_proof_url" });
  });

  it("rejects when URL is not a tweet permalink", async () => {
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: [], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://example.com/" },
    });
    expect(r).toEqual({ status: "rejected", reason: "proof_url_not_a_tweet" });
  });

  it("rejects on wrong author", async () => {
    vi.mocked(xClient.getTweetById).mockResolvedValueOnce({
      id: "123459", text: "#cardano", authorId: "999", createdAt: "2026-02-01T00:00:00Z",
    });
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: ["cardano"], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r).toEqual({ status: "rejected", reason: "wrong_author" });
  });

  it("rejects when tweet is before task start", async () => {
    vi.mocked(xClient.getTweetById).mockResolvedValueOnce({
      id: "123459", text: "#cardano", authorId: "111", createdAt: "2025-01-01T00:00:00Z",
    });
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: ["cardano"], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r).toEqual({ status: "rejected", reason: "tweet_before_task_start" });
  });

  it("rejects when required hashtag missing", async () => {
    vi.mocked(xClient.getTweetById).mockResolvedValueOnce({
      id: "123459", text: "just ada nothing else", authorId: "111", createdAt: "2026-02-01T00:00:00Z",
    });
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: ["cardano"], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/missing_hashtag/);
  });

  it("verifies when all checks pass", async () => {
    vi.mocked(xClient.getTweetById).mockResolvedValueOnce({
      id: "123459",
      text: "Loving #Cardano + @LearnCardano",
      authorId: "111",
      createdAt: "2026-02-01T00:00:00Z",
    });
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: ["cardano"], requiredMentions: ["learncardano"] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("downgrades to needs_review on X API failure", async () => {
    vi.mocked(xClient.getTweetById).mockRejectedValueOnce(new Error("boom"));
    const r = await verifyXTweet({
      taskConfig: { requiredHashtags: [], requiredMentions: [] },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
      submission: { proofUrl: "https://x.com/foo/status/123459" },
    });
    expect(r.status).toBe("needs_review");
    expect(r.reason).toBe("x_api_unavailable");
  });
});

describe("verifyXRetweet", () => {
  const baseTask = { startsAt: null, endsAt: null };
  const user = { stakeAddress: "stake1xyz", xUserId: "111" };

  it("returns needs_review:no_x_account when xUserId absent", async () => {
    const r = await verifyXRetweet({
      taskConfig: { targetTweetId: "123459" },
      task: baseTask,
      user: { ...user, xUserId: null, xAccessTokenEnc: null },
    });
    expect(r.reason).toBe("no_x_account");
  });

  it("verifies when the retweet is found", async () => {
    vi.mocked(xClient.getUserRetweets).mockResolvedValueOnce([
      { retweetedId: "123459", createdAt: "2026-02-01T00:00:00Z" },
    ]);
    const r = await verifyXRetweet({
      taskConfig: { targetTweetId: "123459" },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejects when no matching retweet", async () => {
    vi.mocked(xClient.getUserRetweets).mockResolvedValueOnce([
      { retweetedId: "other", createdAt: "2026-02-01T00:00:00Z" },
    ]);
    const r = await verifyXRetweet({
      taskConfig: { targetTweetId: "123459" },
      task: baseTask,
      user: { ...user, xAccessTokenEnc: accessTokenEnc },
    });
    expect(r).toEqual({ status: "rejected", reason: "retweet_not_found" });
  });
});
