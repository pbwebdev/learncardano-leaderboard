import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NONCE_TTL_SECONDS = 5 * 60;

/**
 * Issue a single-use nonce the wallet will sign. Nonce + issued-at are stored
 * in KV so /api/auth/verify can confirm authenticity and prevent replay.
 *
 * Message template — no DRep line; identity is the bech32 stake address.
 */
export async function GET() {
  const { env } = getCloudflareContext();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const issuedAt = new Date().toISOString();
  await env.KV.put(`auth-nonce:${nonce}`, JSON.stringify({ issuedAt }), {
    expirationTtl: NONCE_TTL_SECONDS,
  });
  return NextResponse.json({
    nonce,
    expires_in: NONCE_TTL_SECONDS,
    message_template:
      `Sign in to Learn Cardano Leaderboard\n` +
      `Nonce: ${nonce}\n` +
      `Issued: ${issuedAt}`,
  });
}
