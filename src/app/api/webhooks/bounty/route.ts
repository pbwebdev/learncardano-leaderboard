/**
 * Bounty webhook receiver — Phase 4.
 *
 * The Learn Cardano Bounty platform POSTs completion events here. We:
 *   1. Verify an HMAC-SHA256 over `${stake_address}.${bounty_id}.${completed_at}`
 *      using the shared `BOUNTY_WEBHOOK_HMAC_SECRET`.
 *   2. Resolve the matching task (taskType='bounty_completion' whose
 *      taskConfig.bountyId === bounty_id).
 *   3. Resolve / no-op if the user doesn't exist on our side yet (200,
 *      drop reason logged — we can't pre-create users from a bounty event).
 *   4. Idempotency: if a submission already exists for (userId, taskId),
 *      return 200 with `already_recorded`. Bounty platform's queue retries
 *      on non-200 so we always return 200 for well-formed signed requests.
 *   5. Insert a verified submission, append pointsLedger row, log audit.
 *
 * Contract documented in docs/task-types.md § bounty_completion.
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { pointsLedger, submissions, tasks, users } from "@/db/schema";
import { logChange } from "@/lib/audit";
import { parseBountyCompletionConfig, verifyBountyHmac } from "@/lib/verification/bounty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BountyPayload {
  stake_address: string;
  bounty_id: string;
  completed_at: number | string;
  hmac_signature: string;
}

function parseBountyPayload(raw: unknown): BountyPayload | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stake = typeof o.stake_address === "string" ? o.stake_address.trim() : null;
  const bountyId = typeof o.bounty_id === "string" ? o.bounty_id.trim() : null;
  const sig = typeof o.hmac_signature === "string" ? o.hmac_signature.trim() : null;
  const completedAt =
    typeof o.completed_at === "number" || typeof o.completed_at === "string" ? o.completed_at : null;
  if (!stake || !bountyId || !sig || completedAt == null) return null;
  return { stake_address: stake, bounty_id: bountyId, completed_at: completedAt, hmac_signature: sig };
}

export async function POST(req: Request) {
  try {
    const { env } = getCloudflareContext();
    const secret = (env as { BOUNTY_WEBHOOK_HMAC_SECRET?: string }).BOUNTY_WEBHOOK_HMAC_SECRET;
    if (!secret) {
      console.error("[webhook:bounty] secret not configured");
      // 503 here (not 200) — partner SHOULD retry; we just haven't deployed
      // the secret yet. Other failure modes below return 200 so the partner
      // doesn't retry-storm on application-state issues.
      return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
    }

    const raw = await req.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.warn("[webhook:bounty] malformed JSON");
      return NextResponse.json({ ok: true, dropped: "malformed_json" });
    }

    const event = parseBountyPayload(payload);
    if (!event) {
      console.warn("[webhook:bounty] unrecognised payload shape");
      return NextResponse.json({ ok: true, dropped: "bad_shape" });
    }

    const ok = await verifyBountyHmac(
      secret,
      event.stake_address,
      event.bounty_id,
      event.completed_at,
      event.hmac_signature,
    );
    if (!ok) {
      // Bad signature → 401. We DO want the partner to know this one failed
      // (vs silent 200 drops which signal "we got it, don't retry").
      console.warn("[webhook:bounty] bad signature for bounty", event.bounty_id);
      return NextResponse.json({ error: "bad_signature" }, { status: 401 });
    }

    const db = getDb();

    // Resolve task by bountyId — taskType='bounty_completion' and the JSON
    // taskConfig contains our bountyId. SQLite stores taskConfig as TEXT; we
    // use json_extract to read the bountyId field server-side.
    const matchingTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.taskType, "bounty_completion"),
          sql`json_extract(${tasks.taskConfig}, '$.bountyId') = ${event.bounty_id}`,
        ),
      )
      .limit(2);
    if (matchingTasks.length === 0) {
      console.warn("[webhook:bounty] no task for bounty_id", event.bounty_id);
      return NextResponse.json({ ok: true, dropped: "no_task_for_bounty" });
    }
    if (matchingTasks.length > 1) {
      console.warn("[webhook:bounty] multiple tasks share bounty_id — using first", event.bounty_id);
    }
    const task = matchingTasks[0];

    // Re-validate the task config in case it changed since admin save.
    try {
      parseBountyCompletionConfig(task.taskConfig);
    } catch (e) {
      console.warn("[webhook:bounty] task config invalid", e);
      return NextResponse.json({ ok: true, dropped: "task_config_invalid" });
    }

    if (task.status !== "active") {
      console.warn("[webhook:bounty] task not active, dropping", task.id);
      return NextResponse.json({ ok: true, dropped: "task_not_active" });
    }

    // Resolve user. We don't auto-create — the user must have signed in at
    // least once for us to have a stake_address row. Otherwise drop & 200.
    const user = (
      await db.select().from(users).where(eq(users.stakeAddress, event.stake_address)).limit(1)
    )[0];
    if (!user) {
      console.warn("[webhook:bounty] unknown user (not signed in yet)", event.stake_address.slice(0, 12));
      return NextResponse.json({ ok: true, dropped: "user_not_found" });
    }

    // Idempotency: if there's already a submission for (userId, taskId),
    // don't insert again. We treat any prior submission for this task as
    // "already recorded" — the same bounty completion can only happen once
    // per user even if the partner replays the webhook.
    const existing = await db
      .select({ id: submissions.id, status: submissions.status })
      .from(submissions)
      .where(and(eq(submissions.userId, event.stake_address), eq(submissions.taskId, task.id)))
      .limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, already_recorded: true, submissionId: existing[0].id });
    }

    // Insert verified submission. Note: txHash is null for webhook events
    // (the bounty platform doesn't sit on-chain). The UNIQUE index on
    // (userId, taskId, txHash) treats NULLs as distinct in SQLite, so the
    // application-level check above is what enforces no-duplicates here.
    const submissionId = crypto.randomUUID();
    const completedAtMs =
      typeof event.completed_at === "number"
        ? event.completed_at
        : Number(event.completed_at) || Date.now();
    const completedDate = new Date(completedAtMs > 1e12 ? completedAtMs : completedAtMs * 1000);

    await db.insert(submissions).values({
      id: submissionId,
      userId: event.stake_address,
      taskId: task.id,
      status: "verified",
      submittedAt: completedDate,
      verifiedAt: new Date(),
      notes: `bounty_webhook:${event.bounty_id}`,
    });

    if (task.points && task.points !== 0) {
      await db.insert(pointsLedger).values({
        userId: event.stake_address,
        delta: task.points,
        reason: "task_verified",
        submissionId,
        note: `bounty_completion:${event.bounty_id}`,
      });
    }

    await logChange({
      userId: "system:bounty_webhook",
      entityType: "submission",
      entityId: submissionId,
      field: "status",
      oldValue: null,
      newValue: "verified",
    });

    console.log("[webhook:bounty] verified submission inserted", {
      submissionId,
      taskId: task.id,
      points: task.points,
    });

    return NextResponse.json({ ok: true, submissionId });
  } catch (e) {
    console.error("[webhook:bounty] unexpected", e);
    // 200 anyway — non-2xx triggers retry storms. The error is logged.
    return NextResponse.json({ ok: true, dropped: "internal_error" });
  }
}
