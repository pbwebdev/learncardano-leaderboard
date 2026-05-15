import { describe, expect, it, vi } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { DUB_WEBHOOK_SECRET: "shh" } }),
}));

import { verifyHmacSha256 } from "./hmac";

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("dub webhook: HMAC", () => {
  it("verifies a correct signature", async () => {
    const body = '{"ok":true}';
    const sig = await hmacHex("shh", body);
    expect(await verifyHmacSha256("shh", body, sig)).toBe(true);
    expect(await verifyHmacSha256("shh", body, "sha256=" + sig)).toBe(true);
  });

  it("rejects a wrong signature", async () => {
    const body = '{"ok":true}';
    const sig = await hmacHex("shh", body);
    expect(await verifyHmacSha256("shh", body + "tamper", sig)).toBe(false);
    expect(await verifyHmacSha256("wrong-secret", body, sig)).toBe(false);
  });

  it("rejects garbage signatures", async () => {
    expect(await verifyHmacSha256("shh", "x", "notbase16")).toBe(false);
    expect(await verifyHmacSha256("shh", "x", "abc")).toBe(false); // odd length
  });
});
