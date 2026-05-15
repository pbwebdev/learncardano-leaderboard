import { redirect } from "next/navigation";
import { getCurrentStakeAddressOrNull } from "@/lib/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SaveForm } from "@/components/save-form";
import { submitOnboarding } from "../actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const stakeAddress = await getCurrentStakeAddressOrNull();
  if (!stakeAddress) {
    redirect("/");
  }

  const rows = await getDb().select().from(users).where(eq(users.stakeAddress, stakeAddress)).limit(1);
  if (rows[0]?.onboardingCompleted) {
    redirect("/me");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Welcome — tell us a bit about you</h1>
      <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
        These answers are private and admin-only. They help us tune rewards and
        understand who the community is. They are never shown on your public
        profile.
      </p>

      <SaveForm action={submitOnboarding} className="mt-8 space-y-6 font-sans text-sm">
        <fieldset className="space-y-2">
          <legend className="font-semibold">Age bracket</legend>
          {["<18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((bracket) => (
            <label key={bracket} className="flex items-center gap-2">
              <input type="radio" name="ageBracket" value={bracket} required />
              <span>{bracket}</span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="country" className="block font-semibold">Country</label>
          <input id="country" name="country" type="text" placeholder="AU" maxLength={3} className="w-32" />
          <p className="text-xs text-[color:var(--fg-muted)]">ISO 3166 two- or three-letter code.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="font-semibold">Cardano experience</legend>
          {[
            { v: "newcomer", l: "Newcomer — still learning the basics" },
            { v: "hodler", l: "HODLer — comfortable using a wallet, stake, vote" },
            { v: "power", l: "Power user — DRep, dev, builder, or daily on-chain" },
          ].map(({ v, l }) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="experienceLevel" value={v} required />
              <span>{l}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-semibold">How did you hear about the leaderboard?</legend>
          {[
            { v: "twitter", l: "X (Twitter)" },
            { v: "youtube", l: "YouTube" },
            { v: "friend", l: "A friend / referral" },
            { v: "other", l: "Other" },
          ].map(({ v, l }) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="referralSource" value={v} />
              <span>{l}</span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="invitedByRefCode" className="block font-semibold">Invited by (optional)</label>
          <input id="invitedByRefCode" name="invitedByRefCode" type="text" placeholder="6-char code" maxLength={12} className="w-40" />
        </div>

        <button
          type="submit"
          className="rounded-[--radius-md] bg-[color:var(--accent-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[color:var(--accent-primary-strong)]"
        >
          Finish onboarding
        </button>
      </SaveForm>
    </main>
  );
}
