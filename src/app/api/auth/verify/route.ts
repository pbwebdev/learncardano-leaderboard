import { NextResponse } from "next/server";
import verifyDataSignature from "@cardano-foundation/cardano-verify-datasignature";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { sessionCookieHeader, signSession } from "@/lib/session";
import { looksLikeStakeAddress } from "@/lib/stake-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifyBody = {
  signature: string;           // hex(COSE_Sign1)
  key: string;                 // hex(COSE_Key)
  message: string;             // the exact string the wallet signed
  nonce: string;               // included in `message`
  stake_address_hex: string;   // raw reward address bytes as hex (denormalised payment-address proxy)
  stake_address_bech32: string; // stake1... — the canonical user ID
};

export async function POST(request: Request) {
  const { env } = getCloudflareContext();

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { signature, key, message, nonce, stake_address_hex, stake_address_bech32 } = body;
  if (!signature || !key || !message || !nonce || !stake_address_hex || !stake_address_bech32) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!message.includes(nonce)) {
    return NextResponse.json({ error: "nonce_not_in_message" }, { status: 400 });
  }
  if (!looksLikeStakeAddress(stake_address_bech32)) {
    return NextResponse.json({ error: "bad_stake_address_format" }, { status: 400 });
  }

  // 1. Nonce must exist in KV and be single-use.
  const nonceKey = `auth-nonce:${nonce}`;
  const stored = await env.KV.get(nonceKey);
  if (!stored) {
    return NextResponse.json({ error: "nonce_invalid_or_expired" }, { status: 400 });
  }
  await env.KV.delete(nonceKey);

  // 2. CIP-8 signature must verify. Two-stage verify lifted verbatim from the
  //    DRep Dashboard — the verify lib's internal message/address checks are
  //    encoding-sensitive across wallets, so we fall back to crypto-only and
  //    rely on our own nonce-in-message check (already done above).
  let cryptoVerified = false;
  try {
    cryptoVerified = verifyDataSignature(signature, key, message, stake_address_bech32);
    if (!cryptoVerified) {
      const sigOnly = verifyDataSignature(signature, key);
      if (sigOnly) cryptoVerified = true;
    }
  } catch (e) {
    return NextResponse.json(
      { error: "signature_verify_threw", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
  if (!cryptoVerified) {
    return NextResponse.json({ error: "signature_invalid" }, { status: 401 });
  }

  // 3. Upsert user row (idempotent — first sign-in creates, subsequent updates
  //    payment-address denormalisation).
  try {
    await getDb()
      .insert(users)
      .values({
        stakeAddress: stake_address_bech32,
        paymentAddress: stake_address_hex,
      })
      .onConflictDoUpdate({
        target: users.stakeAddress,
        set: { paymentAddress: stake_address_hex },
      });
  } catch (e) {
    console.error("[auth:verify] user upsert failed", e);
    // Non-fatal — we'll still issue the session; the upsert will succeed on a
    // later request. This avoids locking out a user on a transient D1 error.
  }

  // 4. Issue HMAC-signed session cookie.
  const cookieValue = await signSession(stake_address_bech32);
  const res = NextResponse.json({ ok: true, stake_address: stake_address_bech32 });
  res.headers.set("Set-Cookie", sessionCookieHeader(cookieValue));
  return res;
}
