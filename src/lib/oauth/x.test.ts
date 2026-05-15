import { describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      X_CLIENT_ID: "test-x-client",
      X_CLIENT_SECRET: "test-x-secret",
    },
  }),
}));

import {
  extractTweetId,
  generatePkceVerifier,
  getAuthorizeUrl,
  isXConfigured,
  pkceChallengeFor,
} from "./x";

describe("oauth/x: PKCE", () => {
  it("generates a verifier of the expected length range", () => {
    const v = generatePkceVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    // base64url alphabet
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a deterministic SHA-256 challenge for a fixed verifier", async () => {
    const c1 = await pkceChallengeFor("abc123");
    const c2 = await pkceChallengeFor("abc123");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("oauth/x: authorize URL", () => {
  it("includes all required query params", () => {
    const url = getAuthorizeUrl({
      state: "abc",
      codeChallenge: "ch",
      redirectUri: "https://example.test/cb",
    });
    const u = new URL(url);
    expect(u.hostname).toBe("x.com");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("test-x-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://example.test/cb");
    expect(u.searchParams.get("scope")).toMatch(/offline.access/);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("reports configured when secrets present", () => {
    expect(isXConfigured()).toBe(true);
  });
});

describe("oauth/x: extractTweetId", () => {
  it("parses an x.com status URL", () => {
    expect(extractTweetId("https://x.com/peter/status/1234567890123456789")).toBe(
      "1234567890123456789",
    );
  });
  it("parses a twitter.com legacy URL", () => {
    expect(extractTweetId("https://twitter.com/peter/status/123456?s=20")).toBe("123456");
  });
  it("rejects non-tweet URLs", () => {
    expect(extractTweetId("https://x.com/peter")).toBeNull();
    expect(extractTweetId("https://example.com/peter/status/123")).toBeNull();
    expect(extractTweetId("not a url at all")).toBeNull();
  });
});
