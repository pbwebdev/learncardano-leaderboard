import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * AES-GCM encrypt/decrypt helpers for at-rest OAuth bearer-token storage
 * on the users row. Phase 3.
 *
 * Design notes
 * ------------
 *
 * 1. Why encrypt at all? `users.x{AccessToken,RefreshToken}Enc` (and the
 *    YouTube equivalents) are long-lived bearer tokens that grant API
 *    access to a user's social account. Leaking them = account takeover.
 *    The database is on D1 (Cloudflare-managed), but defence-in-depth
 *    means a stolen DB dump shouldn't be a credentials dump.
 *
 * 2. Why reuse AUTH_SESSION_SECRET? It's already a 32+ byte high-entropy
 *    secret pinned across deploys (session signing requires stability).
 *    We HKDF-derive a *separate* key from it using a fixed info string
 *    `learncardano-leaderboard:user-token-v1`. HKDF's domain separation
 *    means the derived AES-GCM key is cryptographically independent of
 *    the HMAC key used for session cookies — leaking one tells you
 *    nothing about the other, even though both come from the same root.
 *
 * 3. Format: base64url(iv (12 bytes) || ciphertext || tag (16 bytes)).
 *    WebCrypto bundles the auth tag with the ciphertext, so the wire
 *    format is just `iv || subtle.encrypt(...)` (which already contains
 *    the trailing tag).
 *
 * 4. Tamper detection: AES-GCM rejects on bad tag/IV/ciphertext via a
 *    thrown DOMException. We surface that as an Error so callers can
 *    log + return `needs_review` rather than crash the verifier.
 *
 * 5. No key cache. `crypto.subtle.importKey` is cheap and the alternative
 *    (module-scoped CryptoKey) would race with the Cloudflare context
 *    not being available at module load (per GOTCHAS.md §2 / sibling
 *    `session.ts`).
 */

const HKDF_INFO_USER_TOKEN = "learncardano-leaderboard:user-token-v1";
// Empty salt is fine: HKDF spec permits it, and we already domain-separate
// via `info`. Cryptographically equivalent to a zero-byte salt with the
// extract step skipped.
const HKDF_SALT = new Uint8Array(0);
const IV_LENGTH = 12; // 96 bits — NIST-recommended for AES-GCM

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Internal: import the AUTH_SESSION_SECRET as HKDF input material, then
 * derive a 256-bit AES-GCM key using the user-token info string. Reading
 * env happens inside the function (not at module scope) so test mocks
 * via vi.mock(@opennextjs/cloudflare) work — see GOTCHAS.md §9.
 */
async function deriveUserTokenKey(): Promise<CryptoKey> {
  const { env } = getCloudflareContext();
  const secret = (env as { AUTH_SESSION_SECRET?: string }).AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  const ikm = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: new TextEncoder().encode(HKDF_INFO_USER_TOKEN),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a UTF-8 string with the user-token AES-GCM key. Returns
 * `base64url(iv || ciphertext_with_tag)`. Each call uses a fresh
 * 96-bit random IV so identical plaintexts never collide.
 */
export async function encryptString(plaintext: string): Promise<string> {
  const key = await deriveUserTokenKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(iv.length + ctBytes.length);
  out.set(iv, 0);
  out.set(ctBytes, iv.length);
  return b64url(out);
}

/**
 * Decrypt a string produced by `encryptString`. Throws on tamper / bad
 * key / malformed input. Callers in verifier paths should catch and
 * downgrade to `needs_review` so a corrupted token row doesn't crash
 * the verify queue.
 */
export async function decryptString(b64: string): Promise<string> {
  const buf = b64urlDecode(b64);
  if (buf.length < IV_LENGTH + 16) throw new Error("ciphertext_too_short");
  const iv = buf.slice(0, IV_LENGTH);
  const ct = buf.slice(IV_LENGTH);
  const key = await deriveUserTokenKey();
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    // WebCrypto throws an opaque DOMException for any of: bad tag,
    // truncated ciphertext, wrong key. Normalise to a single error so
    // callers don't try to discriminate.
    throw new Error("decrypt_failed");
  }
  return new TextDecoder().decode(pt);
}
