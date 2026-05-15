import { describe, expect, it } from "vitest";
import { bech32 } from "bech32";
import {
  bytesToHex,
  decodeStakeAddress,
  hexToBytes,
  looksLikeStakeAddress,
} from "./stake-address";

function makeMainnetStakeAddress(hash: Uint8Array): string {
  const payload = new Uint8Array(29);
  payload[0] = 0xe1; // mainnet key-credential stake
  payload.set(hash, 1);
  return bech32.encode("stake", bech32.toWords(payload), 200);
}

describe("stake-address helpers", () => {
  it("hexToBytes round-trips through bytesToHex", () => {
    const bytes = new Uint8Array([0x00, 0xab, 0xff, 0x10]);
    expect(bytesToHex(bytes)).toBe("00abff10");
    expect(hexToBytes("00ABff10")).toEqual(bytes);
  });

  it("hexToBytes tolerates a 0x prefix", () => {
    expect(bytesToHex(hexToBytes("0xdeadbeef"))).toBe("deadbeef");
  });

  it("hexToBytes throws on odd-length input", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });

  it("looksLikeStakeAddress accepts well-formed bech32 stake addresses", () => {
    const hash = new Uint8Array(28).fill(0x42);
    const addr = makeMainnetStakeAddress(hash);
    expect(looksLikeStakeAddress(addr)).toBe(true);
  });

  it("looksLikeStakeAddress rejects DRep IDs and garbage", () => {
    expect(looksLikeStakeAddress("drep1yftc8zs7gjcj4a9nxzplz4wg6cwweya0kxp8adnw59vsyrqvrysud")).toBe(false);
    expect(looksLikeStakeAddress("not a stake address")).toBe(false);
    expect(looksLikeStakeAddress("STAKE1ABC")).toBe(false); // uppercase
  });

  it("decodeStakeAddress returns the 28-byte credential hash for a mainnet address", () => {
    const hash = new Uint8Array(28).fill(0x99);
    const addr = makeMainnetStakeAddress(hash);
    const decoded = decodeStakeAddress(addr);
    expect(decoded.network).toBe("mainnet");
    expect(decoded.credentialHash).toEqual(hash);
  });

  it("decodeStakeAddress rejects script-credential stake addresses", () => {
    // Construct a script-credential (0xf1) stake address
    const payload = new Uint8Array(29);
    payload[0] = 0xf1;
    payload.set(new Uint8Array(28).fill(7), 1);
    const addr = bech32.encode("stake", bech32.toWords(payload), 200);
    expect(() => decodeStakeAddress(addr)).toThrow(/script/);
  });

  it("decodeStakeAddress rejects malformed strings", () => {
    expect(() => decodeStakeAddress("stake1notvalid")).toThrow();
    expect(() => decodeStakeAddress("hello")).toThrow();
  });
});
