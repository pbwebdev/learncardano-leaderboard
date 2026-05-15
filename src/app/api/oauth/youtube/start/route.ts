import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import {
  YouTubeOAuthNotConfiguredError,
  generatePkceVerifier,
  getAuthorizeUrl,
  pkceChallengeFor,
} from "@/lib/oauth/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start Google OAuth 2.0 flow (PKCE + confidential client_secret) for
 * the YouTube Data API readonly scope. Mirrors the X start route —
 * see that file for the rationale on state stashing in KV.
 */
export async function GET(req: Request) {
  const stake = await getCurrentStakeAddressOrNull();
  if (!stake) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const url = new URL(req.url);
  const returnTo = sanitiseReturnTo(url.searchParams.get("returnTo")) ?? "/me";
  const redirectUri = new URL("/api/oauth/youtube/callback", `${url.protocol}//${url.host}`).toString();

  const verifier = generatePkceVerifier();
  const challenge = await pkceChallengeFor(verifier);
  const state = generatePkceVerifier().slice(0, 32);

  let authorize: string;
  try {
    authorize = getAuthorizeUrl({ state, codeChallenge: challenge, redirectUri });
  } catch (e) {
    if (e instanceof YouTubeOAuthNotConfiguredError) {
      return NextResponse.json({ error: "oauth_not_configured", provider: "youtube" }, { status: 503 });
    }
    throw e;
  }

  const { env } = getCloudflareContext();
  await env.KV.put(
    `oauth-state:youtube:${state}`,
    JSON.stringify({ verifier, userId: stake, returnTo, redirectUri }),
    { expirationTtl: 600 },
  );

  return NextResponse.redirect(authorize, { status: 302 });
}

function sanitiseReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  return v;
}
