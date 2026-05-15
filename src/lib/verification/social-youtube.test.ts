import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      AUTH_SESSION_SECRET: "test-secret-do-not-use-in-prod-0123456789abcdef",
      GOOGLE_CLIENT_ID: "test-yt",
      GOOGLE_CLIENT_SECRET: "test-yt-secret",
    },
  }),
}));

vi.mock("@/lib/oauth/youtube", async () => {
  const actual = await vi.importActual<typeof import("@/lib/oauth/youtube")>("@/lib/oauth/youtube");
  return {
    ...actual,
    listCommentThreads: vi.fn(),
    isYouTubeConfigured: vi.fn(() => true),
  };
});

import { encryptString } from "@/lib/crypto";
import * as ytClient from "@/lib/oauth/youtube";
import { parseYouTubeCommentConfig, verifyYouTubeComment } from "./social-youtube";

let token: string;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(ytClient.isYouTubeConfigured).mockReturnValue(true);
  token = await encryptString("yt-access-token");
});
afterEach(() => vi.resetAllMocks());

describe("parseYouTubeCommentConfig", () => {
  it("accepts an 11-char video ID", () => {
    expect(parseYouTubeCommentConfig({ videoId: "abcDEF12345" })).toEqual({ videoId: "abcDEF12345" });
  });
  it("rejects malformed video IDs", () => {
    expect(() => parseYouTubeCommentConfig({})).toThrow();
    expect(() => parseYouTubeCommentConfig({ videoId: "short" })).toThrow();
    expect(() => parseYouTubeCommentConfig({ videoId: "with!bad@chars" })).toThrow();
  });
});

describe("verifyYouTubeComment", () => {
  const user = { stakeAddress: "stake1xyz", youtubeChannelId: "UC123", youtubeAccessTokenEnc: "" };

  it("returns needs_review:no_youtube_account when channel missing", async () => {
    const r = await verifyYouTubeComment({
      taskConfig: { videoId: "abcDEF12345" },
      user: { ...user, youtubeChannelId: null, youtubeAccessTokenEnc: null },
    });
    expect(r).toEqual({ status: "needs_review", reason: "no_youtube_account" });
  });

  it("returns needs_review:oauth_not_configured when missing secrets", async () => {
    vi.mocked(ytClient.isYouTubeConfigured).mockReturnValueOnce(false);
    const r = await verifyYouTubeComment({
      taskConfig: { videoId: "abcDEF12345" },
      user: { ...user, youtubeAccessTokenEnc: token },
    });
    expect(r.reason).toBe("oauth_not_configured");
  });

  it("verifies on a matching comment", async () => {
    vi.mocked(ytClient.listCommentThreads).mockResolvedValueOnce([
      { authorChannelId: "UC123", textDisplay: "Great video!" },
    ]);
    const r = await verifyYouTubeComment({
      taskConfig: { videoId: "abcDEF12345" },
      user: { ...user, youtubeAccessTokenEnc: token },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejects when no comment matches", async () => {
    vi.mocked(ytClient.listCommentThreads).mockResolvedValueOnce([
      { authorChannelId: "UC-other", textDisplay: "nope" },
    ]);
    const r = await verifyYouTubeComment({
      taskConfig: { videoId: "abcDEF12345" },
      user: { ...user, youtubeAccessTokenEnc: token },
    });
    expect(r).toEqual({ status: "rejected", reason: "comment_not_found" });
  });

  it("downgrades to needs_review on API failure", async () => {
    vi.mocked(ytClient.listCommentThreads).mockRejectedValueOnce(new Error("boom"));
    const r = await verifyYouTubeComment({
      taskConfig: { videoId: "abcDEF12345" },
      user: { ...user, youtubeAccessTokenEnc: token },
    });
    expect(r).toEqual({ status: "needs_review", reason: "youtube_api_unavailable" });
  });
});
