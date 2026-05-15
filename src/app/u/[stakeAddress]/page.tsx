import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { looksLikeStakeAddress } from "@/lib/stake-address";
import { getPointsFor, getVerifiedCountFor, getProjectsEngagedFor } from "@/lib/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ stakeAddress: string }> }): Promise<Metadata> {
  const { stakeAddress } = await params;
  if (!looksLikeStakeAddress(stakeAddress)) return { title: "Profile not found" };
  return {
    title: `${stakeAddress.slice(0, 12)}…${stakeAddress.slice(-6)}`,
    description: "Public Learn Cardano Leaderboard profile.",
  };
}

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

  const [points, verified, projectsEngaged] = await Promise.all([
    getPointsFor(stakeAddress),
    getVerifiedCountFor(stakeAddress),
    getProjectsEngagedFor(stakeAddress),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">
        {user.xHandle ? `@${user.xHandle}` : "Cardano leaderboard player"}
      </h1>
      <p className="mt-2 font-mono text-xs text-[color:var(--fg-muted)]">
        {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
      </p>

      <section className="mt-8 grid grid-cols-3 gap-3 text-center">
        <Stat label="Points" value={points || "—"} />
        <Stat label="Verified tasks" value={verified || "—"} />
        <Stat label="Projects engaged" value={projectsEngaged || "—"} />
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="font-mono text-2xl">{value}</div>
      <div className="mt-1 text-xs text-[color:var(--fg-muted)]">{label}</div>
    </div>
  );
}
