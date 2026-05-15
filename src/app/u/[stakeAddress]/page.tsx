import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { looksLikeStakeAddress } from "@/lib/stake-address";
import { getPointsFor, getVerifiedCountFor, getProjectsEngagedFor } from "@/lib/points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ stakeAddress: string }> }): Promise<Metadata> {
  const { stakeAddress } = await params;
  if (!looksLikeStakeAddress(stakeAddress)) return { title: "Profile not found" };
  const ogPath = `/og/profile/${encodeURIComponent(stakeAddress)}`;
  return {
    title: `${stakeAddress.slice(0, 12)}…${stakeAddress.slice(-6)}`,
    description: "Public Learn Cardano Leaderboard profile.",
    openGraph: {
      title: `${stakeAddress.slice(0, 12)}…${stakeAddress.slice(-6)} · Learn Cardano Leaderboard`,
      images: [{ url: ogPath, width: 1200, height: 630, type: "image/svg+xml" }],
    },
    twitter: { card: "summary_large_image", images: [ogPath] },
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

  const [points, verified, projectsEngaged, refCountRow] = await Promise.all([
    getPointsFor(stakeAddress),
    getVerifiedCountFor(stakeAddress),
    getProjectsEngagedFor(stakeAddress),
    user.refCode
      ? getDb().select({ n: sql<number>`COUNT(*)` }).from(users).where(eq(users.invitedByRefCode, user.refCode))
      : Promise.resolve([{ n: 0 }] as Array<{ n: number }>),
  ]);
  const referralCount = Number(refCountRow[0]?.n ?? 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl font-bold tracking-tight break-words">
        {user.xHandle ? `@${user.xHandle}` : "Cardano leaderboard player"}
      </h1>
      <p className="mt-2 font-mono text-xs text-[color:var(--fg-muted)] break-all">
        {stakeAddress.slice(0, 16)}…{stakeAddress.slice(-8)}
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <Stat label="Points" value={points || "—"} />
        <Stat label="Verified tasks" value={verified || "—"} />
        <Stat label="Projects engaged" value={projectsEngaged || "—"} />
        <Stat label="Referrals" value={referralCount || "—"} />
      </section>

      {user.refCode && (
        <section className="mt-6 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 sm:p-6 font-sans">
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
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-[color:var(--fg-muted)]">{label}</div>
    </div>
  );
}
