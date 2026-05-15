import { describe, expect, it } from "vitest";
import { generateRefCode, looksLikeRefCode, normaliseRefCode } from "./ref-code";

describe("ref-code", () => {
  it("generates 8 chars by default, all in the Crockford alphabet", () => {
    const code = generateRefCode();
    expect(code.length).toBe(8);
    expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(code)).toBe(true);
  });
  it("normalises visually-confusable chars", () => {
    // o→0, l→1, 1→1, i→1, u→V, q→Q
    expect(normaliseRefCode("ol1iuq")).toBe("0111VQ");
  });
  it("rejects too-short codes", () => {
    expect(looksLikeRefCode("ABCD")).toBe(false);
    expect(looksLikeRefCode("ABCDEF")).toBe(true);
  });
  it("rejects out-of-alphabet chars after normalisation", () => {
    // '?' isn't in the alphabet and isn't normalised away.
    expect(looksLikeRefCode("ABC?DEF")).toBe(false);
  });
});
