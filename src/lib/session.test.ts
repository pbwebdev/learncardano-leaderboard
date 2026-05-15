import { describe, expect, it } from "vitest";

// Stub the Cloudflare context module before importing session — session reads
// AUTH_SESSION_SECRET via getCloudflareContext().env.
import { vi } from "vitest";
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { AUTH_SESSION_SECRET: "test-secret-do-not-use-in-prod" },
  }),
}));

import { signSession, verifySession, SESSION_TTL_SECONDS } from "./session";

const TEST_STAKE = "stake1u9q3kqxytestaddrforsessionunit";

describe("session: HMAC sign / verify", () => {
  it("verifies a freshly signed session and returns the stake address", async () => {
    const token = await signSession(TEST_STAKE);
    const payload = await verifySession(token);
    expect(payload?.stake_address).toBe(TEST_STAKE);
  });

  it("token has body.signature shape", async () => {
    const token = await signSession(TEST_STAKE);
    expect(token.split(".").length).toBe(2);
  });

  it("rejects a tampered body", async () => {
    const token = await signSession(TEST_STAKE);
    const [, sig] = token.split(".");
    const fakeBody = Buffer.from(
      JSON.stringify({ stake_address: "stake1u9attacker", iat: 0, exp: Date.now() / 1000 + 3600 }),
    ).toString("base64url");
    const tampered = `${fakeBody}.${sig}`;
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const token = await signSession(TEST_STAKE);
    const [body] = token.split(".");
    expect(await verifySession(`${body}.AAAA`)).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifySession(null)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession("noseparator")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const realNow = Date.now;
    const issued = realNow();
    const token = await signSession(TEST_STAKE);
    try {
      Date.now = () => issued + (SESSION_TTL_SECONDS + 60) * 1000;
      expect(await verifySession(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("issued tokens stay valid before expiry", async () => {
    const realNow = Date.now;
    const issued = realNow();
    const token = await signSession(TEST_STAKE);
    try {
      Date.now = () => issued + 60_000; // one minute later
      const payload = await verifySession(token);
      expect(payload?.stake_address).toBe(TEST_STAKE);
    } finally {
      Date.now = realNow;
    }
  });
});
