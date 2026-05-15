/**
 * Per-user shareable referral code helpers. Phase 3.
 *
 * 8-char base32 (Crockford alphabet — no I/L/O/U to avoid confusing
 * characters in shared codes). One refCode per user, generated on
 * first sign-in if missing. UNIQUE column constraint enforces no
 * collisions; this module retries on the rare collision.
 *
 * Why not derive from stake credential? Determinism would mean
 * regenerating gives back the same value, but it also leaks the
 * stake address bytes through the code. A random 8-char base32 has
 * 40 bits of entropy — plenty for collision-resistance across the
 * launch user base, opaque to outside observers.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, 32 chars

export function generateRefCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] & 0x1f];
  return s;
}

/**
 * Normalise an inbound refCode (e.g. from a form field). Upper-cases
 * and strips the visually-confusable letters that aren't in our
 * alphabet — Crockford spec maps O→0, I/L→1, U→V at decode time.
 */
export function normaliseRefCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

export function looksLikeRefCode(raw: string): boolean {
  const n = normaliseRefCode(raw);
  if (n.length < 6 || n.length > 16) return false;
  return [...n].every((c) => ALPHABET.includes(c));
}
