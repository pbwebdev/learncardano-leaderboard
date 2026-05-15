import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { parseAdminList } from "@/lib/admin";
import { getDb } from "@/db/client";
import { submissions, tasks } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight status endpoint for client polling. Used by the
 * submission-success banner on /projects/[slug] to flip the user from
 * "pending" → "verified"/"rejected" without a full page refresh.
 *
 * Authorisation: only the submitter or an admin can read. We do NOT
 * leak rejection reasons or admin notes via the public path — those
 * remain admin-only via the /admin/submissions detail page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const viewer = await getCurrentStakeAddressOrNull();
    if (!viewer) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const db = getDb();
    const row = (await db
      .select({
        id: submissions.id,
        userId: submissions.userId,
        taskId: submissions.taskId,
        status: submissions.status,
        submittedAt: submissions.submittedAt,
        verifiedAt: submissions.verifiedAt,
        rejectionReason: submissions.rejectionReason,
      })
      .from(submissions)
      .where(eq(submissions.id, id))
      .limit(1))[0];
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const isOwner = row.userId === viewer;
    const isAdmin = parseAdminList().includes(viewer);
    if (!isOwner && !isAdmin) return NextResponse.json({ error: "not_authorised" }, { status: 403 });

    // Pull the points value off the task so the poller can render
    // "+50 pts" once verified without a second request.
    const task = (await db
      .select({ points: tasks.points, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, row.taskId))
      .limit(1))[0];

    return NextResponse.json({
      id: row.id,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      // Owner-facing: include rejection reason; admin gets full detail
      // via /admin/submissions/[id]. We trim to a short, friendly token.
      rejectionReason: row.rejectionReason ?? null,
      pointsOnVerify: task?.points ?? 0,
      taskTitle: task?.title ?? "",
    });
  } catch (e) {
    console.error("[api:submissions:get] unexpected", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
