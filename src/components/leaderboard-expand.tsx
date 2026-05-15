"use client";

import { useEffect, useState } from "react";

/**
 * Client wrapper that takes the server-rendered "top slice" and "rest slice"
 * markup, and toggles the rest's visibility behind a single button. State
 * persists across navigations via `sessionStorage.leaderboard-expanded` so a
 * user who expands, clicks into a profile, and comes back doesn't have to
 * re-click.
 *
 * The button + slice markup is server-rendered for SEO; this client component
 * only flips display classes. If `restCount <= 0` the button never renders.
 */
const STORAGE_KEY = "leaderboard-expanded";

export function LeaderboardExpand({
  restCount,
  children,
}: {
  restCount: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") setExpanded(true);
    } catch {
      // sessionStorage can throw in private-mode Safari; treat as collapsed.
    }
  }, []);

  useEffect(() => {
    try {
      if (expanded) sessionStorage.setItem(STORAGE_KEY, "1");
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [expanded]);

  if (restCount <= 0) {
    // Wrap children so layout is unchanged; no button.
    return <>{children}</>;
  }

  return (
    <div data-leaderboard-expanded={expanded ? "1" : "0"} className="contents">
      {/* The slotted rest-of-rows markup uses [data-leaderboard-expanded="0"]
          selectors via the parent — but since we can't easily target by parent
          attribute without arbitrary variants, we render children and rely on
          the toggle button to flip a class on the wrapper below. */}
      <div className={expanded ? "" : "[&_[data-leaderboard-rest]]:hidden"}>{children}</div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-[--radius-md] border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--fg)] hover:border-[color:var(--accent-primary)] hover:text-[color:var(--accent-primary)]"
        >
          {expanded ? "Show less" : `Show ${restCount} more`}
        </button>
      </div>
    </div>
  );
}
