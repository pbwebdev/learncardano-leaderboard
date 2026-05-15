import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { clickEvents, trackedLinks, users } from "@/db/schema";
import { verifyHmacSha256 } from "./hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Short.io webhook receiver. Phase 3.
 *
 * Replaces the old Dub.co receiver. Schema columns kept the historical
 * `dub_*` names (see schema.ts) — they're treated as opaque "external
 * link id" / "external event id" values from whichever provider we're
 * currently on. Don't rename without a migration.
 *
 * ─── Documentation gaps ────────────────────────────────────────────────
 * Short.io's public API reference doesn't fully spell out their webhook
 * payload schema or signature header at scrape-time, so the following are
 * documented assumptions. After the first real click fires in production,
 * verify and adjust if needed (only this file + the field names below).
 *
 *   1. Signature header name. We accept any of:
 *        x-short-signature, x-signature, signature, x-webhook-signature
 *      Pick whichever the Short.io dashboard names when wiring the
 *      webhook; if it's a fifth thing, add it to the list.
 *
 *   2. HMAC algorithm: SHA-256 over the raw body, secret = the signing
 *      secret displayed in the Short.io webhook config.
 *
 *   3. Payload fields. We probe common spellings:
 *        link.id / linkId / link_id        → tracked_links.dub_link_id
 *        clickedAt / timestamp / created_at → ts
 *        country                            → country
 *        referer / referrer                 → referrer
 *        userAgent / ua / user_agent        → user_agent
 *        eventId / id                       → click_events.dub_event_id
 *
 * ─── Behaviour ────────────────────────────────────────────────────────
 * - Returns 503 if SHORTIO_WEBHOOK_SECRET is unset.
 * - Returns 401 if signature is missing or invalid.
 * - Always returns 200 after a valid signature even if the payload is
 *   unrecognised or the link is unknown — Short.io retries on non-2xx
 *   and we don't want a retry storm on app-side issues. Internal logs
 *   carry the diagnostic detail.
 * - Idempotency: dedupe by (tracked_link_id, dub_event_id) UNIQUE when
 *   the payload carries an event id; otherwise we fall back to a
 *   (tracked_link_id, ts) tuple within a 5-second window.
 */
export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const secret = (env as { SHORTIO_WEBHOOK_SECRET?: string }).SHORTIO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const raw = await req.text();
  const sig =
    req.headers.get("x-short-signature") ??
    req.headers.get("x-signature") ??
    req.headers.get("signature") ??
    req.headers.get("x-webhook-signature");
  if (!sig) return new Response("missing_signature", { status: 401 });

  const ok = await verifyHmacSha256(secret, raw, sig);
  if (!ok) return new Response("bad_signature", { status: 401 });

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
    // Short.io link we don't know about — possibly created outside our
    // flow in the Short.io dashboard. Log a short prefix and 200.
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

/**
 * Normalise the click payload from Short.io. We probe several spellings
 * because the public docs don't pin them down. See the assumptions block
 * at the top of this file.
 */
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
  // Short.io sometimes nests the click under `data` or `event`; sometimes
  // it's the top-level object.
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
