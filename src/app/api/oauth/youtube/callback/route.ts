import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { encryptString } from "@/lib/crypto";
import { logChange } from "@/lib/audit";
import {
  YouTubeOAuthNotConfiguredError,
  exchangeCode,
  getMyChannel,
} from "@/lib/oauth/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StoredState {
  verifier: string;
  userId: string;
  returnTo: string;
  redirectUri: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return NextResponse.redirect(new URL(`/me?ytLink=denied`, `${url.protocol}//${url.host}`).toString(), { status: 302 });
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const { env } = getCloudflareContext();
  const stateKey = `oauth-state:youtube:${state}`;
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
    if (e instanceof YouTubeOAuthNotConfiguredError) {
      return NextResponse.json({ error: "oauth_not_configured" }, { status: 503 });
    }
    console.error("[oauth:yt:callback] exchange failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?ytLink=exchange_failed`), {
      status: 302,
    });
  }

  let channel;
  try {
    channel = await getMyChannel(tokens.accessToken);
  } catch (e) {
    console.error("[oauth:yt:callback] channels/mine failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?ytLink=channel_failed`), {
      status: 302,
    });
  }
  if (!channel) {
    return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?ytLink=no_channel`), { status: 302 });
  }

  const accessEnc = await encryptString(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? await encryptString(tokens.refreshToken) : null;

  const db = getDb();
  await db
    .update(users)
    .set({
      youtubeChannelId: channel.id,
      youtubeChannelTitle: channel.title,
      youtubeConnectedAt: new Date(),
      youtubeAccessTokenEnc: accessEnc,
      youtubeRefreshTokenEnc: refreshEnc,
      youtubeTokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
    })
    .where(eq(users.stakeAddress, parsed.userId));

  await logChange({
    userId: parsed.userId,
    entityType: "user",
    entityId: parsed.userId,
    field: "youtube_channel_id",
    oldValue: null,
    newValue: channel.id,
  });

  return NextResponse.redirect(redirectTo(url, `${parsed.returnTo}?ytLink=ok`), { status: 302 });
}

function redirectTo(reqUrl: URL, path: string): string {
  return new URL(path, `${reqUrl.protocol}//${reqUrl.host}`).toString();
}
