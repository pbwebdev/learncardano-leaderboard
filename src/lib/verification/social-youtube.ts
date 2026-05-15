/**
 * YouTube comment verifier (`youtube_comment`). Phase 3.
 *
 * Contract:
 *   config: { videoId: string }
 *   1. Require user.youtubeChannelId. Else needs_review:no_youtube_account.
 *   2. List commentThreads on `videoId`.
 *   3. Pass iff any top-level comment's authorChannelId matches the
 *      user's linked channel.
 *
 * `needs_review` (not `rejected`) on missing-account so users who link
 * YouTube *after* submitting still get verified manually by Peter.
 */

import { decryptString } from "@/lib/crypto";
import type { VerifierResult } from "./manual";
import {
  YouTubeOAuthNotConfiguredError,
  isYouTubeConfigured,
  listCommentThreads,
} from "@/lib/oauth/youtube";

export interface YouTubeCommentConfig {
  videoId: string;
}

export class YouTubeConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`youtube_config:${field}:${message}`);
    this.name = "YouTubeConfigError";
    this.field = field;
  }
}

export function parseYouTubeCommentConfig(raw: unknown): YouTubeCommentConfig {
  if (raw == null || typeof raw !== "object") {
    throw new YouTubeConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  // YouTube video IDs are 11 chars in [A-Za-z0-9_-].
  if (typeof obj.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(obj.videoId)) {
    throw new YouTubeConfigError("videoId", "must be an 11-char YouTube video ID");
  }
  return { videoId: obj.videoId };
}

export interface YouTubeVerifierUser {
  stakeAddress: string;
  youtubeChannelId?: string | null;
  youtubeAccessTokenEnc?: string | null;
}

export async function verifyYouTubeComment(opts: {
  taskConfig: unknown;
  user: YouTubeVerifierUser;
}): Promise<VerifierResult> {
  const cfg = parseYouTubeCommentConfig(opts.taskConfig);
  if (!isYouTubeConfigured()) return { status: "needs_review", reason: "oauth_not_configured" };
  if (!opts.user.youtubeChannelId) return { status: "needs_review", reason: "no_youtube_account" };
  if (!opts.user.youtubeAccessTokenEnc) return { status: "needs_review", reason: "no_youtube_token" };

  let accessToken: string;
  try {
    accessToken = await decryptString(opts.user.youtubeAccessTokenEnc);
  } catch {
    return { status: "needs_review", reason: "token_decrypt_failed" };
  }

  let comments;
  try {
    comments = await listCommentThreads({ videoId: cfg.videoId, accessToken });
  } catch (e) {
    if (e instanceof YouTubeOAuthNotConfiguredError) {
      return { status: "needs_review", reason: "oauth_not_configured" };
    }
    console.warn("[verify:youtube_comment] api failure", e instanceof Error ? e.message : e);
    return { status: "needs_review", reason: "youtube_api_unavailable" };
  }

  const match = comments.find((c) => c.authorChannelId === opts.user.youtubeChannelId);
  if (!match) return { status: "rejected", reason: "comment_not_found" };
  return { status: "verified" };
}
