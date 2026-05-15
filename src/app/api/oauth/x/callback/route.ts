import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { encryptString } from "@/lib/crypto";
import { logChange } from "@/lib/audit";
import {
  XOAuthNotConfiguredError,
  exchangeCode,
  getUserMe,
} from "@/lib/oauth/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StoredState {
  verifier: string;
  userId: string;
  returnTo: string;
  redirectUri: string;
}

/**
 * X OAuth callback. Validates state, exchanges the auth code for tokens,
 * fetches /2/users/me, persists encrypted tokens + user_id + handle on
 * the users row, audit-logs, then redirects to `returnTo`.
 *
 * Token plaintext never lands in the DB; the encrypt step uses
 * AUTH_SESSION_SECRET-derived AES-GCM via src/lib/crypto.ts.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return NextResponse.redirect(redirectTo(url, `/me?xLink=denied`), { status: 302 });
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const { env } = getCloudflareContext();
  const stateKey = `oauth-state:x:${state}`;
  const stored = await env.KV.get(stateKey);
  if (!stored) {
    return NextResponse.json({ error: "state_invalid_or_expired" }, { status: 400 });
  }
  await env.KV.delete(stateKey);

  let parsed: StoredState;
  try {
    parsed = JSON.parse(stored) as StoredState;
  } catch {
    return NextResponse.json({ error: "state_malformed" }, { status: 400 });
  }

  let tokens;
  try {
    tokens = await exchangeCode({
      code,
      redirectUri: parsed.redirectUri,
      codeVerifier: parsed.verifier,
    });
  } catch (e) {
    if (e instanceof XOAuthNotConfiguredError) {
      return NextResponse.json({ error: "oauth_not_configured" }, { status: 503 });
    }
    console.error("[oauth:x:callback] exchange failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?xLink=exchange_failed`), {
      status: 302,
    });
  }

  let me;
  try {
    me = await getUserMe(tokens.accessToken);
  } catch (e) {
    console.error("[oauth:x:callback] users/me failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?xLink=identity_failed`), {
      status: 302,
    });
  }

  const accessEnc = await encryptString(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? await encryptString(tokens.refreshToken) : null;

  const db = getDb();
  await db
    .update(users)
    .set({
      xUserId: me.id,
      xHandle: me.username,
      xConnectedAt: new Date(),
      xAccessTokenEnc: accessEnc,
      xRefreshTokenEnc: refreshEnc,
      xTokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    })
    .where(eq(users.stakeAddress, parsed.userId));

  await logChange({
    userId: parsed.userId,
    entityType: "user",
    entityId: parsed.userId,
    field: "x_handle",
    oldValue: null,
    newValue: me.username,
  });

  return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?xLink=ok`), { status: 302 });
}

function redirectTo(reqUrl: URL, path: string): string {
  return new URL(path, `${reqUrl.protocol}//${reqUrl.host}`).toString();
}
