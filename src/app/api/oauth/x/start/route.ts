import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import {
  XOAuthNotConfiguredError,
  generatePkceVerifier,
  getAuthorizeUrl,
  pkceChallengeFor,
} from "@/lib/oauth/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start X (Twitter) OAuth 2.0 PKCE flow.
 *
 * Stashes `{ verifier, userId, returnTo }` in KV keyed by the random
 * state token (10 min TTL — same as the auth nonce TTL). Redirects the
 * user to X's authorize endpoint. The callback route looks the state
 * up and exchanges the code.
 *
 * Returns 503 if X_CLIENT_ID / X_CLIENT_SECRET aren't configured yet —
 * the user-facing copy on submission forms keys off `isXConfigured()`
 * so they should never get here while unconfigured, but the route is
 * defensive.
 */
export async function GET(req: Request) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const returnTo = sanitiseReturnTo(url.searchParams.get("returnTo")) ?? "/me";
  const redirectUri = computeRedirectUri(url, "/api/oauth/x/callback");

  const verifier = generatePkceVerifier();
  const challenge = await pkceChallengeFor(verifier);
  const state = generatePkceVerifier().slice(0, 32);

  let authorize: string;
  try {
    authorize = getAuthorizeUrl({ state, codeChallenge: challenge, redirectUri });
  } catch (e) {
    if (e instanceof XOAuthNotConfiguredError) {
      return NextResponse.json({ error: "oauth_not_configured", provider: "x" }, { status: 503 });
    }
    throw e;
  }

  const { env } = getCloudflareContext();
  await env.KV.put(
    `oauth-state:x:${state}`,
    JSON.stringify({ verifier, userId: stake, returnTo, redirectUri }),
    { expirationTtl: 600 },
  );

  return NextResponse.redirect(authorize, { status: 302 });
}

function computeRedirectUri(reqUrl: URL, path: string): string {
  const u = new URL(path, `${reqUrl.protocol}//${reqUrl.host}`);
  return u.toString();
}

function sanitiseReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  return v;
}
