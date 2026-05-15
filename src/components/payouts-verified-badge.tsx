/**
 * Public-surface trust-signal badge. Shown next to a project name when
 * every partner_payout_batches row for that project has verifiedOnChain=1.
 *
 * Tooltip / aria-label explains the meaning — visible to keyboard +
 * screen-reader users without depending on hover. Keep this server-safe
 * (no client deps); rendered inline by /projects, /projects/[slug].
 */
export function PayoutsVerifiedBadge({ compact = false }: { compact?: boolean }) {
  const label = "Payouts verified ✓";
  const explanation =
    "Every partner payout for this project has been verified on-chain by an independent cron job.";
  return (
    <span
      title={explanation}
      aria-label={`${label}. ${explanation}`}
      className={
        compact
          ? "inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900"
          : "inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900"
      }
    >
      {label}
    </span>
  );
}
