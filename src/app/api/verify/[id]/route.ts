/**
 * Admin manual re-verify trigger.
 *
 *   POST /api/verify/[id]
 *
 * Enqueues `{ submissionId: id }` to VERIFY_QUEUE. The queue consumer
 * (`src/queues/verify-consumer.ts`) idempotently re-runs the verifier and
 * updates the submission. Useful when:
 *   - a verifier returned `needs_review` (auto-retried 3x, then marked
 *     `verifier_unavailable` — admin re-trigger after the upstream recovers)
 *   - a `tx_swap` submission is still `unconfirmed` and the user reports
 *     the tx has settled
 *   - manual investigation reveals a verifier bug was hit and you want a
 *     re-run after a code deploy.
 *
 * Admin-only (`requireAdmin`). Audit-logged. Returns the enqueue status.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { submissions } from "@/db/schema";
import { logChange } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyQueueLike {
  send(body: unknown): Promise<void>;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminId = await requireAdmin();
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
    const db = getDb();
    const sub = (await db.select().from(submissions).where(eq(submissions.id, id)).limit(1))[0];
    if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { env } = getCloudflareContext();
    const q = (env as unknown as { VERIFY_QUEUE?: VerifyQueueLike }).VERIFY_QUEUE;
    if (!q) return NextResponse.json({ error: "queue_not_bound" }, { status: 500 });
    await q.send({ submissionId: id });

    await logChange({
      userId: adminId,
      entityType: "submission",
      entityId: id,
      field: "_re_verify",
      oldValue: sub.status,
      newValue: "enqueued",
    });

    return NextResponse.json({ ok: true, submissionId: id });
  } catch (e) {
    if (e instanceof Error && e.message === "not_authenticated") {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    if (e instanceof Error && e.message === "not_authorised") {
      return NextResponse.json({ error: "not_authorised" }, { status: 403 });
    }
    console.error("[api:verify:re-verify] unexpected", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
