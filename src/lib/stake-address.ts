import { bech32 } from "bech32";

/**
 * Phase 2 extension — DRep ID derivation. Ported from the sibling project's
 * `src/lib/drep-id.ts` (`drepIdFromRewardAddress`). Used by the
 * `drep_registered` verifier: given a user's bech32 stake address, return
 * the CIP-105 key-hash DRep ID they would self-register as.
 *
 * Script-credential stake addresses are not supported (script DReps need
 * different handling; the project's auth flow already rejects them upstream).
 */

/**
 * Bech32 helpers for Cardano stake addresses (`stake1...` on mainnet).
 *
 * Subset of the sibling project's `src/lib/drep-id.ts` — we only need:
 *   - shape validation (regex + bech32 decode)
 *   - hex <-> bytes conversions for verifying signatures from CIP-30 wallets
 *
 * Reward address bytes layout (29 bytes, same as DRep dashboard):
 *   [ network_byte ][ 28-byte stake credential hash ]
 *   network_byte: 0xe0 testnet, 0xe1 mainnet, 0xf0 testnet script, 0xf1 mainnet script
 */

const STAKE_BECH32_RE = /^stake1[0-9a-z]+$/;

/** Cheap pre-flight check — pattern only. Use `decodeStakeAddress` for full validation. */
export function looksLikeStakeAddress(s: string): boolean {
  return STAKE_BECH32_RE.test(s);
}

/**
 * Decode a bech32 stake address and return the 28-byte credential hash.
 * Throws if the address is malformed, has the wrong HRP, or has a script
 * credential (script-credential stake addresses aren't supported for sign-in).
 */
export function decodeStakeAddress(stakeBech32: string): {
  network: "mainnet" | "testnet";
  credentialHash: Uint8Array;
} {
  if (!looksLikeStakeAddress(stakeBech32)) throw new Error("not_a_stake_address");
  const { prefix, words } = bech32.decode(stakeBech32, 200);
  if (prefix !== "stake" && prefix !== "stake_test") throw new Error("bad_hrp");
  const bytes = new Uint8Array(bech32.fromWords(words));
  if (bytes.length < 29) throw new Error("reward address too short");
  const network = bytes[0];
  if (network === 0xf0 || network === 0xf1) {
    throw new Error("script-credential stake addresses are not supported for sign-in");
  }
  return {
    network: network === 0xe1 || network === 0xf1 ? "mainnet" : "testnet",
    credentialHash: bytes.slice(1, 29),
  };
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex string has odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive a CIP-105 key-hash DRep ID (`drep1...`) from a bech32 stake address.
 * Throws on script-credential addresses or malformed inputs.
 */
export function drepIdFromStakeAddress(stakeBech32: string): string {
  const { credentialHash } = decodeStakeAddress(stakeBech32);
  return drepIdFromKeyHash(credentialHash);
}

/**
 * Wrap a 28-byte stake credential hash as a bech32 DRep ID. Header byte 0x22
 * marks a key-hash credential (the only case we currently support).
 */
export function drepIdFromKeyHash(keyHash: Uint8Array): string {
  if (keyHash.length !== 28) {
    throw new Error(`stake key hash must be 28 bytes, got ${keyHash.length}`);
  }
  const payload = new Uint8Array(29);
  payload[0] = 0x22; // key-hash DRep credential header
  payload.set(keyHash, 1);
  const words = bech32.toWords(payload);
  return bech32.encode("drep", words, 200);
}
