import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { looksLikeStakeAddress } from "@/lib/stake-address";

export const dynamic = "force-dynamic";

/**
 * Public profile page. Returns notFound() unless the user has
 * profileVisibility='public'. NEVER renders onboarding-survey fields
 * (age, country, experience, referral source) — those are admin-only PII.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ stakeAddress: string }>;
}) {
  const { stakeAddress } = await params;
  if (!looksLikeStakeAddress(stakeAddress)) {
    notFound();
  }

  const rows = await getDb()
    .select({
      stakeAddress: users.stakeAddress,
      profileVisibility: users.profileVisibility,
      refCode: users.refCode,
      createdAt: users.createdAt,
      xHandle: users.xHandle,
    })
    .from(users)
    .where(eq(users.stakeAddress, stakeAddress))
    .limit(1);

  const user = rows[0];
  if (!user || user.profileVisibility !== "public") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">
        {user.xHandle ? `@${user.xHandle}` : "Cardano leaderboard player"}
      </h1>
      <p className="mt-2 font-mono text-xs text-[color:var(--fg-muted)]">
        {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
      </p>

      <section className="mt-8 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
        <h2 className="text-lg font-semibold">Points</h2>
        <p className="mt-2 font-mono text-2xl text-[color:var(--fg)]">— pts</p>
        <p className="mt-2 text-xs text-[color:var(--fg-muted)]">
          Public points totals land in Phase 1.
        </p>
      </section>

      {user.refCode && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 font-sans">
          <h2 className="text-lg font-semibold">Referral code</h2>
          <code className="mt-2 inline-block rounded bg-[color:var(--bg-code)] px-2 py-1 font-mono text-sm">
            {user.refCode}
          </code>
        </section>
      )}
    </main>
  );
}
