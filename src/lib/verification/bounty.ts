/**
 * Bounty completion verifier — Phase 4.
 *
 * `bounty_completion` is a webhook-only task type. The Learn Cardano Bounty
 * platform POSTs to `/api/webhooks/bounty` with a completion event. The
 * webhook handler creates the submission directly in `verified` state.
 *
 * So this "verifier" exists mostly to:
 *   1. Validate the `taskConfig = { bountyId: string }` shape (admin UI calls
 *      `parseBountyCompletionConfig` before saving a task);
 *   2. Refuse stray user-initiated submissions of this type (defence in
 *      depth — `canSubmitForTask` should reject earlier, but the verifier
 *      backs it up).
 *   3. Compute and verify the HMAC over `${stake_address}.${bounty_id}.${completed_at}`
 *      that the webhook handler uses (`verifyBountyHmac`).
 *
 * `taskConfig` shape:
 *   { bountyId: string }
 *
 * Hand-rolled parser — no zod dep (project constraint).
 */

import type { VerifierResult } from "./manual";

export interface BountyCompletionConfig {
  bountyId: string;
}

export class BountyCompletionConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`bounty_completion_config:${field}:${message}`);
    this.name = "BountyCompletionConfigError";
    this.field = field;
  }
}

export function parseBountyCompletionConfig(raw: unknown): BountyCompletionConfig {
  if (raw == null || typeof raw !== "object") {
    throw new BountyCompletionConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const bountyId = obj.bountyId;
  if (typeof bountyId !== "string" || bountyId.trim().length === 0) {
    throw new BountyCompletionConfigError("bountyId", "required, non-empty string");
  }
  if (bountyId.length > 256) {
    throw new BountyCompletionConfigError("bountyId", "max length 256");
  }
  return { bountyId: bountyId.trim() };
}

/**
 * Verifier surface — webhook-only. If a submission for this task type ends
 * up flowing through the queue consumer's normal verify path (it shouldn't,
 * because `canSubmitForTask` returns webhook_only_task_type), reject it
 * loudly so audit logs surface the anomaly.
 */
export function verifyBountyCompletion(opts: { taskConfig: unknown }): VerifierResult {
  // Re-parse; surfaces config errors during the queue path if an admin
  // somehow saved a malformed config.
  parseBountyCompletionConfig(opts.taskConfig);
  return { status: "rejected", reason: "bounty_completion_is_webhook_only" };
}

/**
 * HMAC-SHA-256 over the canonical bounty webhook payload string.
 * Web Crypto only — runs on Workers. See GOTCHAS § Web Crypto.
 *
 * The signed payload is the literal concatenation:
 *   `${stake_address}.${bounty_id}.${completed_at}`
 *
 * `completed_at` is sent as the number / string the partner provided;
 * we render it verbatim so both sides compute the same digest.
 */
export async function computeBountyHmac(
  secret: string,
  stakeAddress: string,
  bountyId: string,
  completedAt: number | string,
): Promise<string> {
  const message = `${stakeAddress}.${bountyId}.${completedAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bufToHex(sigBuf);
}

/**
 * Constant-time-ish HMAC compare. Web Crypto's verify() would be cleaner
 * but it expects raw signature bytes; partners send hex. We hex-encode our
 * computed digest and string-compare with a length-equalising xor scan.
 */
export async function verifyBountyHmac(
  secret: string,
  stakeAddress: string,
  bountyId: string,
  completedAt: number | string,
  providedHex: string,
): Promise<boolean> {
  const expected = await computeBountyHmac(secret, stakeAddress, bountyId, completedAt);
  const a = expected.toLowerCase();
  const b = (providedHex ?? "").trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
