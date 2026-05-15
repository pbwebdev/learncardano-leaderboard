/**
 * Google / YouTube OAuth 2.0 + Data API v3 helpers. Phase 3.
 *
 * Mirrors src/lib/oauth/x.ts in structure. Like the X client every export
 * here throws `YouTubeOAuthNotConfiguredError` when GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET are absent so routes can return a clean 503.
 *
 * Scopes:
 *   - https://www.googleapis.com/auth/youtube.readonly  list comments + channel info
 *   - openid + email  for identity (we don't actually persist email, but
 *     the openid scope unlocks the id_token and is required for some Google
 *     verification flows in dev console)
 *
 * Google's authorization_code grant supports both PKCE and confidential
 * client_secret. We use both belt-and-braces — PKCE makes the code single-
 * use even if the redirect leaks.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export class YouTubeOAuthNotConfiguredError extends Error {
  constructor() {
    super("youtube_oauth_not_configured");
    this.name = "YouTubeOAuthNotConfiguredError";
  }
}

export interface YouTubeClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeOAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope: string;
  tokenType: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
}

export interface YouTubeCommentItem {
  authorChannelId?: string;
  textDisplay: string;
}

const USER_AGENT = "learncardano-leaderboard/0.1 (+https://leaderboard.learncardano.io)";

function getYouTubeClient(): YouTubeClientConfig {
  const { env } = getCloudflareContext();
  const e = env as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new YouTubeOAuthNotConfiguredError();
  return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
}

export function isYouTubeConfigured(): boolean {
  try {
    getYouTubeClient();
    return true;
  } catch {
    return false;
  }
}

export function generatePkceVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return b64url(bytes);
}

export async function pkceChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function getAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { clientId } = getYouTubeClient();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set(
    "scope",
    "openid email https://www.googleapis.com/auth/youtube.readonly",
  );
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // access_type=offline + prompt=consent ensures we get a refresh_token on
  // first link AND on re-link (Google omits the refresh_token on subsequent
  // grants unless prompt=consent is set).
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<YouTubeOAuthTokens> {
  const { clientId, clientSecret } = getYouTubeClient();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", opts.code);
  body.set("redirect_uri", opts.redirectUri);
  body.set("code_verifier", opts.codeVerifier);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`youtube_token_exchange_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return parseTokens(await res.json());
}

export async function refreshToken(refresh: string): Promise<YouTubeOAuthTokens> {
  const { clientId, clientSecret } = getYouTubeClient();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`youtube_token_refresh_failed:${res.status}`);
  // Google refresh doesn't return a new refresh_token; preserve the old one.
  const t = parseTokens(await res.json());
  return { ...t, refreshToken: t.refreshToken ?? refresh };
}

function parseTokens(raw: unknown): YouTubeOAuthTokens {
  const r = raw as Record<string, unknown>;
  const access = typeof r.access_token === "string" ? r.access_token : null;
  if (!access) throw new Error("youtube_token_response_missing_access_token");
  const expiresIn = typeof r.expires_in === "number" ? r.expires_in : null;
  return {
    accessToken: access,
    refreshToken: typeof r.refresh_token === "string" ? r.refresh_token : null,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scope: typeof r.scope === "string" ? r.scope : "",
    tokenType: typeof r.token_type === "string" ? r.token_type : "Bearer",
  };
}

/** Get the authenticated user's primary YouTube channel id + title. */
export async function getMyChannel(accessToken: string): Promise<YouTubeChannel | null> {
  const u = new URL("https://www.googleapis.com/youtube/v3/channels");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("mine", "true");
  const res = await fetch(u, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`youtube_channels_mine_failed:${res.status}`);
  const json = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  };
  const item = json.items?.[0];
  if (!item) return null;
  return { id: item.id, title: item.snippet?.title ?? "" };
}

/**
 * List comment threads on a video, scoped to a channel author. The API's
 * `allThreadsRelatedToChannelId` parameter expects a channel ID; combined
 * with `videoId` it returns comment threads on that video authored by
 * any user (we filter to the requesting user's channel ourselves).
 *
 * Returns at most ~100 items per call. The verifier short-circuits on
 * first match so paging isn't necessary in the common case.
 */
export async function listCommentThreads(opts: {
  videoId: string;
  accessToken: string;
}): Promise<YouTubeCommentItem[]> {
  const u = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("videoId", opts.videoId);
  u.searchParams.set("maxResults", "100");
  const res = await fetch(u, {
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`youtube_commentthreads_failed:${res.status}`);
  const json = (await res.json()) as {
    items?: Array<{
      snippet?: {
        topLevelComment?: {
          snippet?: {
            authorChannelId?: { value?: string };
            textDisplay?: string;
          };
        };
      };
    }>;
  };
  return (json.items ?? []).map((it) => ({
    authorChannelId: it.snippet?.topLevelComment?.snippet?.authorChannelId?.value,
    textDisplay: it.snippet?.topLevelComment?.snippet?.textDisplay ?? "",
  }));
}
