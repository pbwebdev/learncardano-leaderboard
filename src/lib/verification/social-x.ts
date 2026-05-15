/**
 * X (Twitter) verifiers: `x_tweet` and `x_retweet`. Phase 3.
 *
 * Contract (CLAUDE.md + docs/task-types.md):
 *
 *   x_tweet:
 *     config: { requiredHashtags: string[], requiredMentions: string[] }
 *     1. Require user.xUserId. Else needs_review:no_x_account.
 *     2. Extract tweet ID from submission.proofUrl.
 *     3. GET /2/tweets/{id}?expansions=author_id&tweet.fields=created_at,text
 *     4. Pass iff
 *          tweet.author_id === user.xUserId
 *          tweet.created_at >= task.startsAt
 *          text contains every requiredHashtag (case-insensitive)
 *          text contains every requiredMention   (case-insensitive)
 *
 *   x_retweet:
 *     config: { targetTweetId: string }
 *     1. Require user.xUserId. Else needs_review:no_x_account.
 *     2. Page the user's recent tweets, filter for retweet refs.
 *     3. Pass iff any retweet ref equals targetTweetId.
 *
 * Why `needs_review:no_x_account` instead of `rejected`?
 * A user who hasn't linked X yet might link it later (we render a
 * Connect X CTA on the submission form). Rejecting the submission
 * would burn their single per-task submission slot. needs_review
 * keeps the row in admin-review state so Peter can manually verify
 * after the user links and re-submits the URL — also matches the
 * Phase 3 design note in the rollout brief ("verifiers detect 'no X
 * account linked' and return needs_review with a specific reason").
 */

import { decryptString } from "@/lib/crypto";
import type { VerifierResult } from "./manual";
import {
  XOAuthNotConfiguredError,
  extractTweetId,
  getTweetById,
  getUserRetweets,
  isXConfigured,
} from "@/lib/oauth/x";

// ---------------- Config parsers ----------------

export interface XTweetConfig {
  requiredHashtags: string[]; // lower-cased on parse
  requiredMentions: string[]; // lower-cased on parse, leading @ stripped
}

export interface XRetweetConfig {
  targetTweetId: string;
}

export class XConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`x_config:${field}:${message}`);
    this.name = "XConfigError";
    this.field = field;
  }
}

export function parseXTweetConfig(raw: unknown): XTweetConfig {
  if (raw == null || typeof raw !== "object") {
    throw new XConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const hashtags = parseStringArray(obj.requiredHashtags, "requiredHashtags").map((s) =>
    s.replace(/^#/, "").toLowerCase(),
  );
  const mentions = parseStringArray(obj.requiredMentions, "requiredMentions").map((s) =>
    s.replace(/^@/, "").toLowerCase(),
  );
  return { requiredHashtags: hashtags, requiredMentions: mentions };
}

export function parseXRetweetConfig(raw: unknown): XRetweetConfig {
  if (raw == null || typeof raw !== "object") {
    throw new XConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.targetTweetId !== "string" || !/^\d{5,}$/.test(obj.targetTweetId)) {
    throw new XConfigError("targetTweetId", "must be a numeric tweet ID string");
  }
  return { targetTweetId: obj.targetTweetId };
}

function parseStringArray(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new XConfigError(field, "must be an array of strings");
  return v.map((item, i) => {
    if (typeof item !== "string") throw new XConfigError(`${field}[${i}]`, "must be a string");
    return item.trim();
  }).filter(Boolean);
}

// ---------------- Pure text-check helper (unit-testable) ----------------

export function tweetTextContainsAll(text: string, tokens: string[]): { ok: true } | { ok: false; missing: string } {
  const lower = text.toLowerCase();
  for (const t of tokens) {
    if (!lower.includes(t.toLowerCase())) {
      return { ok: false, missing: t };
    }
  }
  return { ok: true };
}

// ---------------- User + submission types ----------------

export interface XVerifierUser {
  stakeAddress: string;
  xUserId?: string | null;
  xAccessTokenEnc?: string | null;
}

export interface XVerifierSubmission {
  proofUrl?: string | null;
}

export interface XVerifierTask {
  startsAt?: Date | number | null;
  endsAt?: Date | number | null;
}

// ---------------- x_tweet ----------------

export async function verifyXTweet(opts: {
  taskConfig: unknown;
  task: XVerifierTask;
  user: XVerifierUser;
  submission: XVerifierSubmission;
}): Promise<VerifierResult> {
  const cfg = parseXTweetConfig(opts.taskConfig);
  if (!isXConfigured()) return { status: "needs_review", reason: "oauth_not_configured" };
  if (!opts.user.xUserId) return { status: "needs_review", reason: "no_x_account" };
  if (!opts.user.xAccessTokenEnc) return { status: "needs_review", reason: "no_x_token" };

  const url = (opts.submission.proofUrl ?? "").trim();
  if (!url) return { status: "rejected", reason: "missing_proof_url" };
  const tweetId = extractTweetId(url);
  if (!tweetId) return { status: "rejected", reason: "proof_url_not_a_tweet" };

  let accessToken: string;
  try {
    accessToken = await decryptString(opts.user.xAccessTokenEnc);
  } catch {
    return { status: "needs_review", reason: "token_decrypt_failed" };
  }

  let tweet;
  try {
    tweet = await getTweetById({ tweetId, accessToken });
  } catch (e) {
    if (e instanceof XOAuthNotConfiguredError) {
      return { status: "needs_review", reason: "oauth_not_configured" };
    }
    console.warn("[verify:x_tweet] api failure", e instanceof Error ? e.message : e);
    return { status: "needs_review", reason: "x_api_unavailable" };
  }
  if (!tweet) return { status: "rejected", reason: "tweet_not_found" };
  if (tweet.authorId !== opts.user.xUserId) return { status: "rejected", reason: "wrong_author" };

  const startsAt = toMillis(opts.task.startsAt);
  if (startsAt != null) {
    const created = Date.parse(tweet.createdAt);
    if (Number.isNaN(created) || created < startsAt) {
      return { status: "rejected", reason: "tweet_before_task_start" };
    }
  }

  const hashtagCheck = tweetTextContainsAll(tweet.text, cfg.requiredHashtags.map((h) => "#" + h));
  if (!hashtagCheck.ok) return { status: "rejected", reason: `missing_hashtag:${hashtagCheck.missing}` };
  const mentionCheck = tweetTextContainsAll(tweet.text, cfg.requiredMentions.map((m) => "@" + m));
  if (!mentionCheck.ok) return { status: "rejected", reason: `missing_mention:${mentionCheck.missing}` };

  return { status: "verified" };
}

// ---------------- x_retweet ----------------

export async function verifyXRetweet(opts: {
  taskConfig: unknown;
  task: XVerifierTask;
  user: XVerifierUser;
}): Promise<VerifierResult> {
  const cfg = parseXRetweetConfig(opts.taskConfig);
  if (!isXConfigured()) return { status: "needs_review", reason: "oauth_not_configured" };
  if (!opts.user.xUserId) return { status: "needs_review", reason: "no_x_account" };
  if (!opts.user.xAccessTokenEnc) return { status: "needs_review", reason: "no_x_token" };

  let accessToken: string;
  try {
    accessToken = await decryptString(opts.user.xAccessTokenEnc);
  } catch {
    return { status: "needs_review", reason: "token_decrypt_failed" };
  }

  let retweets;
  try {
    retweets = await getUserRetweets({ xUserId: opts.user.xUserId, accessToken });
  } catch (e) {
    if (e instanceof XOAuthNotConfiguredError) {
      return { status: "needs_review", reason: "oauth_not_configured" };
    }
    console.warn("[verify:x_retweet] api failure", e instanceof Error ? e.message : e);
    return { status: "needs_review", reason: "x_api_unavailable" };
  }

  const startsAt = toMillis(opts.task.startsAt);
  const match = retweets.find((rt) => {
    if (rt.retweetedId !== cfg.targetTweetId) return false;
    if (startsAt == null) return true;
    const ts = Date.parse(rt.createdAt);
    return Number.isNaN(ts) ? true : ts >= startsAt;
  });
  if (!match) return { status: "rejected", reason: "retweet_not_found" };
  return { status: "verified" };
}

function toMillis(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return v.getTime();
}
