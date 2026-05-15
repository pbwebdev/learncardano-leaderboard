/**
 * X (Twitter) API v2 OAuth 2.0 + tweet/retweet read helpers. Phase 3.
 *
 * All env-reading happens inside functions (not module scope) so unit
 * tests can mock the Cloudflare context (GOTCHAS.md §9). When the
 * X_CLIENT_ID / X_CLIENT_SECRET secrets are absent every export below
 * throws a sentinel `Error("x_oauth_not_configured")` — callers in
 * route handlers translate that into a 503 with a clear message.
 *
 * X API docs referenced (current at time of writing):
 *   - OAuth 2.0 user context with PKCE:
 *     https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token
 *   - GET /2/tweets/:id
 *   - GET /2/users/:id/retweets (NOT /retweets/of/X — the X v2 surface
 *     doesn't expose a single endpoint to ask "did user U retweet T".
 *     We page the user's recent retweets and match on tweet ID. This is
 *     the documented substitute approach.)
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export class XOAuthNotConfiguredError extends Error {
  constructor() {
    super("x_oauth_not_configured");
    this.name = "XOAuthNotConfiguredError";
  }
}

export interface XClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface XOAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  // unix ms when the access token expires (Date.now() + expires_in*1000).
  expiresAt?: number | null;
  scope: string;
  tokenType: string;
}

export interface XUserMe {
  id: string;
  username: string;
  name?: string;
}

export interface XTweet {
  id: string;
  text: string;
  authorId: string;
  createdAt: string; // ISO8601 from X API
}

/**
 * Get the configured client credentials. Throws if missing — callers
 * should catch and surface "oauth_not_configured".
 */
function getXClient(): XClientConfig {
  const { env } = getCloudflareContext();
  const e = env as { X_CLIENT_ID?: string; X_CLIENT_SECRET?: string };
  if (!e.X_CLIENT_ID || !e.X_CLIENT_SECRET) throw new XOAuthNotConfiguredError();
  return { clientId: e.X_CLIENT_ID, clientSecret: e.X_CLIENT_SECRET };
}

/**
 * True iff X OAuth secrets are present — used by submission UIs to
 * decide whether to show a "Connect X" CTA vs an "X integration not
 * configured yet" placeholder.
 */
export function isXConfigured(): boolean {
  try {
    getXClient();
    return true;
  } catch {
    return false;
  }
}

const USER_AGENT = "learncardano-leaderboard/0.1 (+https://leaderboard.learncardano.io)";

// PKCE helpers — code_verifier is 43-128 chars URL-safe base64.
// X requires either S256 or plain; we use S256.

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

/** Build the authorize URL the user is redirected to. */
export function getAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { clientId } = getXClient();
  const u = new URL("https://x.com/i/oauth2/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", "tweet.read users.read offline.access");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/**
 * Exchange the authorization code for access + refresh tokens.
 * X requires HTTP Basic auth (client_id:client_secret) on the token
 * endpoint when the app is configured as confidential.
 */
export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<XOAuthTokens> {
  const { clientId, clientSecret } = getXClient();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", opts.code);
  body.set("redirect_uri", opts.redirectUri);
  body.set("code_verifier", opts.codeVerifier);
  body.set("client_id", clientId);
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "user-agent": USER_AGENT,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`x_token_exchange_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return parseTokens(await res.json());
}

export async function refreshToken(refreshToken: string): Promise<XOAuthTokens> {
  const { clientId, clientSecret } = getXClient();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", clientId);
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
      "user-agent": USER_AGENT,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`x_token_refresh_failed:${res.status}`);
  return parseTokens(await res.json());
}

function parseTokens(raw: unknown): XOAuthTokens {
  const r = raw as Record<string, unknown>;
  const access = typeof r.access_token === "string" ? r.access_token : null;
  if (!access) throw new Error("x_token_response_missing_access_token");
  const expiresIn = typeof r.expires_in === "number" ? r.expires_in : null;
  return {
    accessToken: access,
    refreshToken: typeof r.refresh_token === "string" ? r.refresh_token : null,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scope: typeof r.scope === "string" ? r.scope : "",
    tokenType: typeof r.token_type === "string" ? r.token_type : "bearer",
  };
}

export async function getUserMe(accessToken: string): Promise<XUserMe> {
  const res = await fetch("https://api.x.com/2/users/me", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`x_users_me_failed:${res.status}`);
  const json = (await res.json()) as { data?: { id?: string; username?: string; name?: string } };
  const d = json.data;
  if (!d?.id || !d?.username) throw new Error("x_users_me_malformed");
  return { id: d.id, username: d.username, name: d.name };
}

export async function getTweetById(opts: {
  tweetId: string;
  accessToken: string;
}): Promise<XTweet | null> {
  const u = new URL(`https://api.x.com/2/tweets/${encodeURIComponent(opts.tweetId)}`);
  u.searchParams.set("expansions", "author_id");
  u.searchParams.set("tweet.fields", "created_at,text,author_id");
  const res = await fetch(u, {
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`x_get_tweet_failed:${res.status}`);
  const json = (await res.json()) as {
    data?: { id: string; text: string; author_id: string; created_at: string };
  };
  const d = json.data;
  if (!d) return null;
  return { id: d.id, text: d.text, authorId: d.author_id, createdAt: d.created_at };
}

/**
 * Return the user's recent retweets (up to ~max_results=100 per page).
 * The verifier checks for `targetTweetId` in the returned list. We do
 * NOT page the full history — if a user retweeted ages ago the task
 * window will have closed anyway.
 *
 * Note: X v2 returns the *retweeted* tweet IDs in the `referenced_tweets`
 * expansion of each item. The simpler approach (used here) is to fetch
 * the user's recent tweets with `tweet.fields=referenced_tweets`, filter
 * to entries where any referenced_tweet has type='retweeted' and
 * id===targetTweetId.
 */
export async function getUserRetweets(opts: {
  xUserId: string;
  accessToken: string;
  maxResults?: number;
}): Promise<Array<{ retweetedId: string; createdAt: string }>> {
  const u = new URL(`https://api.x.com/2/users/${encodeURIComponent(opts.xUserId)}/tweets`);
  u.searchParams.set("max_results", String(opts.maxResults ?? 100));
  u.searchParams.set("tweet.fields", "created_at,referenced_tweets");
  const res = await fetch(u, {
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`x_user_tweets_failed:${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      created_at: string;
      referenced_tweets?: Array<{ type: string; id: string }>;
    }>;
  };
  const items = json.data ?? [];
  return items
    .flatMap((t) => (t.referenced_tweets ?? []).map((r) => ({ ...r, parentCreatedAt: t.created_at })))
    .filter((r) => r.type === "retweeted")
    .map((r) => ({ retweetedId: r.id, createdAt: r.parentCreatedAt }));
}

/**
 * Extract the tweet ID from a status URL. Supports both x.com and the
 * legacy twitter.com host. Returns null if the URL doesn't look like a
 * tweet permalink.
 */
export function extractTweetId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?(x|twitter)\.com$/.test(u.hostname)) return null;
    // Path shape: /<handle>/status/<id>[/...]
    const m = u.pathname.match(/\/status\/(\d{5,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
