import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin";
import { getDb } from "@/db/client";
import { partnerPayoutBatches } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/payouts/[batchId]/csv — streams the batch's CSV from R2.
 *
 * Admin-only; we authenticate via requireAdmin() each request because the
 * R2 bucket itself isn't public-readable. No long-lived signed URL — the
 * admin re-clicks Download each time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    await requireAdmin();
    const { batchId } = await params;
    const db = getDb();
    const batch = (await db.select().from(partnerPayoutBatches).where(eq(partnerPayoutBatches.id, batchId)).limit(1))[0];
    if (!batch) return new Response("not_found", { status: 404 });

    const { env } = getCloudflareContext();
    const r2 = (env as unknown as { R2?: R2Bucket }).R2;
    if (!r2) return new Response("r2_not_bound", { status: 503 });

    const obj = await r2.get(batch.csvR2Key);
    if (!obj) return new Response("csv_missing", { status: 404 });

    return new Response(obj.body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payout-${batchId.slice(0, 8)}.csv"`,
        "cache-control": "private, max-age=0, no-store",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "not_authenticated") return new Response("not_authenticated", { status: 401 });
    if (e instanceof Error && e.message === "not_authorised") return new Response("not_authorised", { status: 403 });
    console.error("[admin:payouts:csv] unexpected", e);
    return new Response("internal", { status: 500 });
  }
}
