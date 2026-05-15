import { describe, expect, it, vi } from "vitest";

// Mock the Cloudflare context BEFORE importing the module under test
// (GOTCHAS.md §9). The test secret must be deterministic and >= 32 chars.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      AUTH_SESSION_SECRET: "test-secret-do-not-use-in-prod-0123456789abcdef",
    },
  }),
}));

import { encryptString, decryptString } from "./crypto";

describe("crypto: AES-GCM round-trip", () => {
  it("encrypts and decrypts an arbitrary token", async () => {
    const plain = "x-oauth-access-token-AAAA1234zzzz";
    const ct = await encryptString(plain);
    expect(ct).not.toBe(plain);
    // Two encryptions of the same plaintext should differ (random IV).
    const ct2 = await encryptString(plain);
    expect(ct).not.toBe(ct2);
    // Both decrypt back.
    expect(await decryptString(ct)).toBe(plain);
    expect(await decryptString(ct2)).toBe(plain);
  });

  it("handles empty strings", async () => {
    const ct = await encryptString("");
    expect(await decryptString(ct)).toBe("");
  });

  it("handles UTF-8 (emoji + multibyte)", async () => {
    const plain = "channelTitle: 🇦🇺 Australia — naïve façade";
    const ct = await encryptString(plain);
    expect(await decryptString(ct)).toBe(plain);
  });

  it("rejects tampered ciphertext", async () => {
    const ct = await encryptString("sensitive-token");
    // Flip one base64url character mid-ciphertext (not the IV bytes).
    const bytes = ct.split("");
    const idx = Math.floor(bytes.length / 2);
    bytes[idx] = bytes[idx] === "a" ? "b" : "a";
    const tampered = bytes.join("");
    await expect(decryptString(tampered)).rejects.toThrow(/decrypt_failed|ciphertext_too_short/);
  });

  it("rejects truncated ciphertext", async () => {
    const ct = await encryptString("a-token");
    await expect(decryptString(ct.slice(0, 4))).rejects.toThrow(/decrypt_failed|ciphertext_too_short/);
  });

  it("rejects garbage input", async () => {
    await expect(decryptString("not-real-base64-data")).rejects.toThrow();
  });
});
