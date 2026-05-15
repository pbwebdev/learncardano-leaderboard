"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Full-reload save pattern — the only thing that reliably refreshes RSC
 * payload on OpenNext + Cloudflare. `revalidatePath()` is unreliable here
 * (see GOTCHAS.md §2).
 *
 * Flow on submit:
 *   1. Stash window.scrollY in sessionStorage.
 *   2. Fade body opacity → 0 over 200ms (respects prefers-reduced-motion).
 *   3. Await the server action (passed as the form's `action` prop or via
 *      `onAction`).
 *   4. window.location.reload().
 *   5. On mount in the new page, read sessionStorage and restore scroll
 *      using requestAnimationFrame so the layout has painted.
 */
const SCROLL_KEY = "save-form:scrollY";

export function SaveForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  // Restore scroll on mount if a previous save stashed one.
  useEffect(() => {
    const raw = typeof window !== "undefined" ? sessionStorage.getItem(SCROLL_KEY) : null;
    if (raw == null) return;
    sessionStorage.removeItem(SCROLL_KEY);
    const y = Number(raw);
    if (Number.isFinite(y)) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, []);

  function fadeOut(): Promise<void> {
    return new Promise((resolve) => {
      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReduced) return resolve();
      document.body.style.transition = "opacity 200ms ease-out";
      document.body.style.opacity = "0";
      setTimeout(resolve, 220);
    });
  }

  return (
    <form
      ref={formRef}
      action={(formData) => {
        sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
        setSubmitting(true);
        startTransition(async () => {
          try {
            await action(formData);
          } finally {
            await fadeOut();
            window.location.reload();
          }
        });
      }}
      className={className}
      aria-busy={isPending || submitting ? "true" : "false"}
    >
      {children}
    </form>
  );
}
