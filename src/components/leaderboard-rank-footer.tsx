"use client";

import { useEffect, useState } from "react";

/**
 * Sticky footer shown on /leaderboard when the signed-in user is outside
 * the top 100. Dismissible — dismissal stored in
 * `sessionStorage.leaderboard-rank-footer-dismissed` so it doesn't reappear
 * while the user is browsing the same session.
 */
const STORAGE_KEY = "leaderboard-rank-footer-dismissed";

export function LeaderboardRankFooter(props: {
  rank: number;
  totalPoints: number;
  verifiedSubmissions: number;
  projectsEngaged: number;
}) {
  const [dismissed, setDismissed] = useState(true);

  // Hide on first paint; show after mount only if not previously dismissed.
  // Prevents an SSR-flash since the component is client-only anyway.
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY);
      setDismissed(v === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--accent-primary)] bg-[color:var(--surface)] shadow-[var(--shadow-card)]"
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="text-sm text-[color:var(--fg)]">
          You: rank <span className="font-mono font-semibold">#{props.rank}</span>
          <span className="mx-1 text-[color:var(--fg-faint)]">·</span>
          <span className="font-mono">{props.totalPoints}</span> pts
          <span className="mx-1 text-[color:var(--fg-faint)]">·</span>
          <span className="font-mono">{props.verifiedSubmissions}</span> verified
          <span className="mx-1 text-[color:var(--fg-faint)]">·</span>
          <span className="font-mono">{props.projectsEngaged}</span> projects
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className="rounded p-1 text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--fg)]"
          onClick={() => {
            try {
              sessionStorage.setItem(STORAGE_KEY, "1");
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
