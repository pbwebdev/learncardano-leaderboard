import { describe, expect, it } from "vitest";
import { checkUpload, proofR2Key, MAX_UPLOAD_BYTES } from "./uploads";

describe("uploads: checkUpload size + mimetype guards", () => {
  it("accepts a 1 KB PNG", () => {
    expect(checkUpload({ size: 1024, type: "image/png" })).toEqual({
      ok: true,
      ext: "png",
      mimetype: "image/png",
    });
  });

  it("accepts JPEG and WEBP", () => {
    expect(checkUpload({ size: 1024, type: "image/jpeg" }).ok).toBe(true);
    expect(checkUpload({ size: 1024, type: "image/webp" }).ok).toBe(true);
  });

  it("rejects empty uploads", () => {
    expect(checkUpload({ size: 0, type: "image/png" })).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects files exceeding the 5 MB cap", () => {
    expect(checkUpload({ size: MAX_UPLOAD_BYTES + 1, type: "image/png" })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("accepts files exactly at the cap", () => {
    expect(checkUpload({ size: MAX_UPLOAD_BYTES, type: "image/png" }).ok).toBe(true);
  });

  it("rejects disallowed mimetypes (PDF, gif, octet-stream, fake-png)", () => {
    expect(checkUpload({ size: 1024, type: "application/pdf" })).toEqual({
      ok: false,
      reason: "bad_mimetype",
    });
    expect(checkUpload({ size: 1024, type: "image/gif" }).ok).toBe(false);
    expect(checkUpload({ size: 1024, type: "application/octet-stream" }).ok).toBe(false);
    expect(checkUpload({ size: 1024, type: "" }).ok).toBe(false);
  });
});

describe("uploads: proofR2Key", () => {
  it("builds the documented key shape", () => {
    expect(
      proofR2Key({
        userId: "stake1u9abc",
        submissionId: "11111111-2222-3333-4444-555555555555",
        ext: "png",
      }),
    ).toBe("submissions/stake1u9abc/11111111-2222-3333-4444-555555555555/proof.png");
  });

  it("sanitises stray characters in segments", () => {
    expect(
      proofR2Key({
        userId: "stake1u9abc/../etc",
        submissionId: "sub id",
        ext: "p ng",
      }),
    ).toBe("submissions/stake1u9abc_.._etc/sub_id/proof.p_ng");
  });

  it("accepts a custom suffix", () => {
    expect(
      proofR2Key({ userId: "stake1u", submissionId: "id", ext: "png", suffix: "extra" }),
    ).toBe("submissions/stake1u/id/extra.png");
  });
});
