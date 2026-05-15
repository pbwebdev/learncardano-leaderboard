/**
 * Short.io API client (https://developers.short.io/reference). Phase 3.
 *
 * Surface (mirrors the old dub.ts so call sites don't change shape):
 *   - createShortLink({ originalURL, domain?, path?, externalId?, tags? })
 *   - getShortLink(id)
 *
 * When SHORTIO_API_KEY is absent every export throws ShortIoNotConfiguredError
 * with message `short_io_not_configured`. Route handlers map to 503; admin
 * actions log + swallow so a project save still succeeds when secrets are
 * missing (parity with the old Dub flow).
 *
 * Auth: Short.io's REST API uses the API key directly as the value of the
 * `Authorization` header (no `Bearer ` prefix) — this matches their public
 * code samples. If they ever change to bearer-style, only this file changes.
 *
 * Idempotency: Short.io does not surface a client-supplied `externalId` field
 * the way Dub did. We pass `allowDuplicates: false` so re-POSTing the same
 * (originalURL, domain, path) returns the existing link's row instead of
 * 409'ing. The previous `externalId` semantics are reconstructed by the
 * caller persisting the returned link id in our own `tracked_links` /
 * `projects.dub_link_id` columns (column names retained — see schema.ts).
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export class ShortIoNotConfiguredError extends Error {
  constructor() {
    super("short_io_not_configured");
    this.name = "ShortIoNotConfiguredError";
  }
}

export interface ShortLink {
  /** Short.io's numeric internal id (number, but we keep it as string to match the column type). */
  id: string;
  /** Full short URL, e.g. https://link.learncardano.io/abc. */
  shortURL: string;
  /** Destination. */
  originalURL: string;
}

const USER_AGENT = "learncardano-leaderboard/0.1 (+https://leaderboard.learncardano.io)";
const SHORTIO_BASE = "https://api.short.io";
const DEFAULT_DOMAIN = "link.learncardano.io";

interface ShortIoEnv {
  SHORTIO_API_KEY?: string;
  SHORTIO_DOMAIN?: string;
}

function getEnv(): ShortIoEnv {
  const { env } = getCloudflareContext();
  return env as unknown as ShortIoEnv;
}

function getApiKey(): string {
  const e = getEnv();
  if (!e.SHORTIO_API_KEY) throw new ShortIoNotConfiguredError();
  return e.SHORTIO_API_KEY;
}

export function getDefaultDomain(): string {
  return getEnv().SHORTIO_DOMAIN ?? DEFAULT_DOMAIN;
}

export function isShortIoConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

export interface CreateShortLinkInput {
  originalURL: string;
  domain?: string;
  /** Custom slug; Short.io auto-generates when omitted. */
  path?: string;
  /**
   * Carried through as a tag so we can find it in Short.io's dashboard but
   * NOT used for idempotency (Short.io has no externalId concept). The
   * caller owns idempotency via our `tracked_links` table.
   */
  externalId?: string;
  tags?: string[];
}

async function shortIoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
    // Short.io takes the raw API key as the Authorization header value.
    authorization: apiKey,
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(`${SHORTIO_BASE}${path}`, { ...init, headers });
}

export async function createShortLink(input: CreateShortLinkInput): Promise<ShortLink> {
  const tags = [...(input.tags ?? [])];
  if (input.externalId) tags.push(`ext:${input.externalId}`);
  const body: Record<string, unknown> = {
    originalURL: input.originalURL,
    domain: input.domain ?? getDefaultDomain(),
    // false → Short.io returns the existing link for an already-shortened
    // (originalURL, domain[, path]) tuple instead of creating a duplicate.
    allowDuplicates: false,
  };
  if (input.path) body.path = input.path;
  if (tags.length > 0) body.tags = tags;

  const res = await shortIoFetch("/links", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`short_io_api_error:${res.status}:${text.slice(0, 200)}`);
  }
  return normaliseLink(await res.json());
}

export async function getShortLink(id: string): Promise<ShortLink | null> {
  const res = await shortIoFetch(`/links/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`short_io_api_error:${res.status}:${text.slice(0, 200)}`);
  }
  return normaliseLink(await res.json());
}

function normaliseLink(raw: unknown): ShortLink {
  if (raw == null || typeof raw !== "object") throw new Error("short_io_link_malformed");
  const r = raw as Record<string, unknown>;
  // Short.io has historically returned both numeric `id` and string `idString`;
  // prefer idString when present, fall back to coercing id.
  const idRaw = (typeof r.idString === "string" && r.idString) || r.id;
  const id = typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : null;
  const shortURL = typeof r.shortURL === "string"
    ? r.shortURL
    : typeof r.secureShortURL === "string"
      ? (r.secureShortURL as string)
      : null;
  const originalURL = typeof r.originalURL === "string" ? r.originalURL : null;
  if (!id || !shortURL || !originalURL) throw new Error("short_io_link_malformed");
  return { id, shortURL, originalURL };
}
