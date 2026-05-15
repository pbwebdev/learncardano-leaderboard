"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NavLink } from "./nav-link";

/**
 * Mobile-only disclosure for the header nav. Uses a native <details>
 * element for state — keyboard- and screen-reader-accessible by default,
 * no extra JS dependency. The tiny effect just auto-closes the disclosure
 * when the route changes (e.g. user tapped a link).
 *
 * The desktop nav (md+) is rendered directly in layout.tsx; this component
 * is hidden at md+ via `md:hidden`.
 */
export function MobileNav() {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (ref.current?.open) ref.current.open = false;
  }, [pathname]);

  const linkClass =
    "block px-3 py-3 text-sm text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--bg-elevated)] rounded-[--radius-md] tap-target";
  const activeClass = "text-[color:var(--fg)] font-medium";

  function close() {
    if (ref.current) ref.current.open = false;
  }

  return (
    <details ref={ref} className="md:hidden relative">
      <summary
        aria-label="Open navigation menu"
        className="list-none cursor-pointer rounded-[--radius-md] border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-2 py-2 tap-target inline-flex items-center justify-center hover:bg-[color:var(--bg-elevated)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </summary>
      <div className="absolute left-0 right-0 top-full mt-2 z-40 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-2 shadow-[var(--shadow-card)] flex flex-col gap-1">
        <NavLink href="/leaderboard" className={linkClass} activeClassName={activeClass} onNavigate={close}>
          Leaderboard
        </NavLink>
        <NavLink href="/projects" className={linkClass} activeClassName={activeClass} onNavigate={close}>
          Projects
        </NavLink>
        <NavLink href="/me" className={linkClass} activeClassName={activeClass} onNavigate={close}>
          My dashboard
        </NavLink>
      </div>
    </details>
  );
}
