/**
 * File-upload guards for screenshot proofs.
 *
 * Cloudflare R2 has no built-in mimetype/size enforcement — we do both
 * in the upload server action and re-check here. Pure functions: take an
 * inbound File-like and return a discriminated accept/reject result.
 *
 * R2 key scheme:
 *   submissions/${userId}/${submissionId}/${suffix}.${ext}
 *
 * Suffix is `proof` for the user-uploaded screenshot. `userId` is the
 * bech32 stake address. Allowed mimetypes: PNG / JPEG / WEBP. Max 5 MB.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_MIMETYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedMimetype = (typeof ALLOWED_MIMETYPES)[number];

const EXT_BY_MIMETYPE: Record<AllowedMimetype, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadGuardResult =
  | { ok: true; ext: string; mimetype: AllowedMimetype }
  | { ok: false; reason: "too_large" | "bad_mimetype" | "empty" };

export function checkUpload(input: { size: number; type: string }): UploadGuardResult {
  if (input.size === 0) return { ok: false, reason: "empty" };
  if (input.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  if (!ALLOWED_MIMETYPES.includes(input.type as AllowedMimetype)) {
    return { ok: false, reason: "bad_mimetype" };
  }
  const mimetype = input.type as AllowedMimetype;
  return { ok: true, ext: EXT_BY_MIMETYPE[mimetype], mimetype };
}

/**
 * Compose the R2 key for a proof upload. Inputs are not trusted — the
 * caller has already validated `userId` is the signed-in stake address
 * and `submissionId` is the new UUID. We sanitise just-in-case (only
 * letters/numbers/underscore/dash/dot/slash in the key).
 */
export function proofR2Key(opts: {
  userId: string;
  submissionId: string;
  ext: string;
  suffix?: string;
}): string {
  const suffix = sanitiseSegment(opts.suffix ?? "proof");
  const userId = sanitiseSegment(opts.userId);
  const submissionId = sanitiseSegment(opts.submissionId);
  const ext = sanitiseSegment(opts.ext);
  return `submissions/${userId}/${submissionId}/${suffix}.${ext}`;
}

function sanitiseSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_.\-]/g, "_");
}
