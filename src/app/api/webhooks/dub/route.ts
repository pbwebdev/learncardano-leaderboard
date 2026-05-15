import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { clickEvents, trackedLinks, users } from "@/db/schema";
import { verifyHmacSha256 } from "./hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dub.co webhook receiver. Phase 3.
 *
 * Verifies an HMAC-SHA256 signature over the raw request body
 * (header: `Dub-Signature` — current Dub docs spell it
 * `webhook-signature`/`x-dub-signature` depending on version; we accept
 * either). On success: look up tracked_links by Dub link id, derive
 * user from refCode if present, insert a click_events row.
 *
 * Idempotency: click_events has UNIQUE(tracked_link_id, dub_event_id).
 * Dub retries on non-2xx; we always return 200 once HMAC verifies and
 * the payload is well-formed. Schema drift handled inline (CLAUDE.md
 * § Schema ingestion — normalise on the import edge).
 *
 * Returns 200 unconditionally after HMAC verification so Dub doesn't
 * retry once-good deliveries when downstream state changes. (Repeat
 * deliveries are caught by the UNIQUE index and silently skipped.)
 */
export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const secret = (env as { DUB_WEBHOOK_SECRET?: string }).DUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }
  const raw = await req.text();
  const sig =
    req.headers.get("Dub-Signature") ??
    req.headers.get("x-dub-signature") ??
    req.headers.get("webhook-signature");
  if (!sig) return new Response("missing_signature", { status: 401 });

  const ok = await verifyHmacSha256(secret, raw, sig);
  if (!ok) return new Response("bad_signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed JSON shouldn't trigger a retry — return 200 to drop.
    console.warn("[webhook:dub] malformed JSON");
    return NextResponse.json({ ok: true, dropped: "malformed_json" });
  }

  const event = normaliseClickEvent(payload);
  if (!event) {
    console.warn("[webhook:dub] unrecognised event shape");
    return NextResponse.json({ ok: true, dropped: "unrecognised_shape" });
  }

  const db = getDb();
  const link = (await db.select().from(trackedLinks).where(eq(trackedLinks.dubLinkId, event.linkId)).limit(1))[0];
  if (!link) {
    // Dub link we don't know about — possibly an admin-created link
    // outside our flow. Log and 200.
    console.warn("[webhook:dub] unknown dub link id", event.linkId.slice(0, 8));
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
    // Likely UNIQUE violation on (tracked_link_id, dub_event_id) —
    // exactly the idempotency case we want. Swallow + 200.
    console.log("[webhook:dub] duplicate or insert error", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}

/**
 * Normalise the click payload from whatever Dub's current event shape
 * is. We accept the documented top-level `{ event, click, link, ... }`
 * shape and the bare `{ linkId, click: {...} }` legacy shape.
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
  const data = (p.data ?? p) as Record<string, unknown>;
  const click = (data.click ?? data) as Record<string, unknown>;
  const link = (data.link ?? p.link) as Record<string, unknown> | undefined;
  const linkId = typeof link?.id === "string"
    ? link.id
    : typeof click.linkId === "string"
      ? click.linkId
      : typeof data.linkId === "string"
        ? (data.linkId as string)
        : null;
  if (!linkId) return null;
  const eventId =
    typeof click.id === "string"
      ? click.id
      : typeof p.id === "string"
        ? p.id
        : null;
  return {
    linkId,
    eventId,
    country: typeof click.country === "string" ? click.country : null,
    referrer: typeof click.referer === "string" ? click.referer : typeof click.referrer === "string" ? (click.referrer as string) : null,
    userAgent: typeof click.ua === "string" ? click.ua : typeof click.userAgent === "string" ? (click.userAgent as string) : null,
    ts:
      typeof click.timestamp === "number"
        ? click.timestamp
        : typeof click.timestamp === "string"
          ? Date.parse(click.timestamp)
          : null,
  };
}

