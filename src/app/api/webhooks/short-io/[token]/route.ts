import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { clickEvents, trackedLinks, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short.io webhook receiver — URL-as-secret auth.
 *
 * Short.io's standard tier doesn't surface a webhook signing secret, so we
 * authenticate the request by embedding an unguessable random token into
 * the webhook URL itself:
 *
 *   POST /api/webhooks/short-io/<SHORTIO_WEBHOOK_TOKEN>
 *
 * The token comes from `env.SHORTIO_WEBHOOK_TOKEN` (32 random bytes hex,
 * generated via `openssl rand -hex 32`). The full URL is the credential —
 * anyone with it can spoof clicks, so it lives only in the Short.io
 * webhook config + as a Worker secret, never in source control.
 *
 * Schema columns still use the historical `dub_*` names (see schema.ts).
 * Treat them as opaque "external link id" / "external event id" values
 * from whatever provider we're on. Don't rename without a migration.
 *
 * ─── Behaviour ────────────────────────────────────────────────────────
 * - Returns 503 if SHORTIO_WEBHOOK_TOKEN is unset.
 * - Returns 401 if the path token doesn't match (constant-time compare).
 * - Always returns 200 after a valid token even if the payload is
 *   unrecognised or the link is unknown — Short.io retries on non-2xx
 *   and we don't want a retry storm on app-side issues. Internal logs
 *   carry the diagnostic detail.
 * - Idempotency: dedupe by (tracked_link_id, dub_event_id) UNIQUE when
 *   the payload carries an event id; otherwise (tracked_link_id, ts)
 *   tuple via the same UNIQUE constraint.
 *
 * ─── Documentation gaps ────────────────────────────────────────────────
 * Short.io's public API reference doesn't fully spell out their webhook
 * payload schema at scrape-time, so the payload-field names below are
 * documented assumptions. After the first real click fires in production,
 * verify and adjust if needed (only this file).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { env } = getCloudflareContext();
  const expected = (env as { SHORTIO_WEBHOOK_TOKEN?: string }).SHORTIO_WEBHOOK_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const { token } = await params;
  if (!constantTimeEqual(token, expected)) {
    return new Response("bad_token", { status: 401 });
  }

  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn("[webhook:short-io] malformed JSON");
    return NextResponse.json({ ok: true, dropped: "malformed_json" });
  }

  const event = normaliseClickEvent(payload);
  if (!event) {
    console.warn("[webhook:short-io] unrecognised event shape");
    return NextResponse.json({ ok: true, dropped: "unrecognised_shape" });
  }

  const db = getDb();
  const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.dubLinkId, event.linkId)).limit(1))[0];
  if (!link) {
    console.warn("[webhook:short-io] unknown short link id", event.linkId.slice(0, 8));
    return NextResponse.json({ ok: true, dropped: "unknown_link" });
  }

  let userId: string | null = null;
  if (link.userRefCode) {
    const u = (await db.select({ stakeAddress: users.stakeAddress }).from(users).where(eq(users.refCode, link.userRefCode)).limit(1))[0];
    userId = u?.stakeAddress ?? null;
  }

  try {
    await db.insert(clickEvents).values({
      trackedLinkId: link.id,
      dubEventId: event.eventId,
      userId,
      country: event.country ?? null,
      referrer: event.referrer ?? null,
      userAgent: event.userAgent ?? null,
      ts: event.ts ? new Date(event.ts) : new Date(),
    });
  } catch (e) {
    // Likely UNIQUE violation on (tracked_link_id, dub_event_id) — the
    // intended idempotency path. Swallow + 200.
    console.log("[webhook:short-io] duplicate or insert error", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}

/** Constant-time string compare to thwart timing attacks on the token. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normaliseClickEvent(payload: unknown): {
  linkId: string;
  eventId: string | null;
  country: string | null;
  referrer: string | null;
  userAgent: string | null;
  ts: number | null;
} | null {
  if (payload == null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const data = (p.data ?? p.event ?? p) as Record<string, unknown>;
  const link = (data.link ?? p.link) as Record<string, unknown> | undefined;

  const linkId =
    (typeof link?.idString === "string" && link.idString) ||
    (typeof link?.id === "string" && link.id) ||
    (typeof link?.id === "number" && String(link.id)) ||
    (typeof data.linkId === "string" && data.linkId) ||
    (typeof data.link_id === "string" && (data.link_id as string)) ||
    null;
  if (!linkId) return null;

  const eventId =
    (typeof data.eventId === "string" && data.eventId) ||
    (typeof data.id === "string" && data.id) ||
    (typeof p.id === "string" && p.id) ||
    null;

  const tsRaw = data.clickedAt ?? data.timestamp ?? data.created_at ?? data.createdAt;
  const ts =
    typeof tsRaw === "number"
      ? tsRaw
      : typeof tsRaw === "string"
        ? Number.isFinite(Date.parse(tsRaw))
          ? Date.parse(tsRaw)
          : null
        : null;

  return {
    linkId,
    eventId,
    country: typeof data.country === "string" ? data.country : null,
    referrer:
      typeof data.referer === "string"
        ? data.referer
        : typeof data.referrer === "string"
          ? (data.referrer as string)
          : null,
    userAgent:
      typeof data.userAgent === "string"
        ? data.userAgent
        : typeof data.ua === "string"
          ? (data.ua as string)
          : typeof data.user_agent === "string"
            ? (data.user_agent as string)
            : null,
    ts,
  };
}
