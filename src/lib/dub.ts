/**
 * Dub.co API client (https://dub.co/docs/api-reference). Phase 3.
 *
 * Surface:
 *   - createLink({ url, key?, externalId?, tags? })
 *   - getLink(linkId)
 *   - updateLink(linkId, patch)
 *
 * When DUB_API_KEY is absent every export throws DubNotConfiguredError.
 * Route handlers and admin actions catch and surface as
 * `{ error: 'dub_not_configured' }` 503 or non-fatal admin warning.
 *
 * Idempotency: createLink accepts `externalId` which Dub uses as a
 * client-supplied unique key. Re-creating with the same externalId
 * returns the existing link — we use this for project-level links
 * (`externalId=project:<slug>`) and per-user links
 * (`externalId=<slug>:<refCode>`).
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export class DubNotConfiguredError extends Error {
  constructor() {
    super("dub_not_configured");
    this.name = "DubNotConfiguredError";
  }
}

export interface DubLink {
  id: string;
  shortLink: string; // full URL, e.g. https://dub.sh/abc123
  url: string;       // destination
  key?: string;
  externalId?: string | null;
  tags?: Array<{ id: string; name: string }> | string[];
}

const USER_AGENT = "learncardano-leaderboard/0.1 (+https://leaderboard.learncardano.io)";
const DUB_BASE = "https://api.dub.co";

function getApiKey(): string {
  const { env } = getCloudflareContext();
  const e = env as { DUB_API_KEY?: string };
  if (!e.DUB_API_KEY) throw new DubNotConfiguredError();
  return e.DUB_API_KEY;
}

export function isDubConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

export interface CreateLinkInput {
  url: string;
  externalId?: string;
  key?: string;
  tags?: string[];
  domain?: string;
}

export async function createLink(input: CreateLinkInput): Promise<DubLink> {
  const apiKey = getApiKey();
  const body: Record<string, unknown> = { url: input.url };
  if (input.externalId) body.externalId = input.externalId;
  if (input.key) body.key = input.key;
  if (input.tags) body.tagNames = input.tags;
  if (input.domain) body.domain = input.domain;
  const res = await fetch(`${DUB_BASE}/links`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409 && input.externalId) {
    // Conflict on externalId — Dub treats externalId as unique. Fetch
    // and return the existing link rather than failing.
    return getLinkByExternalId(input.externalId);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dub_create_link_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return normaliseLink(await res.json());
}

export async function getLink(linkId: string): Promise<DubLink | null> {
  const apiKey = getApiKey();
  const res = await fetch(`${DUB_BASE}/links/${encodeURIComponent(linkId)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`dub_get_link_failed:${res.status}`);
  return normaliseLink(await res.json());
}

export async function getLinkByExternalId(externalId: string): Promise<DubLink> {
  const apiKey = getApiKey();
  const u = new URL(`${DUB_BASE}/links/info`);
  u.searchParams.set("externalId", externalId);
  const res = await fetch(u, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`dub_get_link_external_failed:${res.status}`);
  return normaliseLink(await res.json());
}

export async function updateLink(linkId: string, patch: Partial<CreateLinkInput>): Promise<DubLink> {
  const apiKey = getApiKey();
  const body: Record<string, unknown> = {};
  if (patch.url) body.url = patch.url;
  if (patch.key) body.key = patch.key;
  if (patch.tags) body.tagNames = patch.tags;
  const res = await fetch(`${DUB_BASE}/links/${encodeURIComponent(linkId)}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dub_update_link_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return normaliseLink(await res.json());
}

function normaliseLink(raw: unknown): DubLink {
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const shortLink = typeof r.shortLink === "string" ? r.shortLink : null;
  const url = typeof r.url === "string" ? r.url : null;
  if (!id || !shortLink || !url) throw new Error("dub_link_malformed");
  return {
    id,
    shortLink,
    url,
    key: typeof r.key === "string" ? r.key : undefined,
    externalId: typeof r.externalId === "string" ? r.externalId : null,
    tags: Array.isArray(r.tags) ? (r.tags as DubLink["tags"]) : undefined,
  };
}
