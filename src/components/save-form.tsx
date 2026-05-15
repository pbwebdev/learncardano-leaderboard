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
 *   4. If the action threw a NEXT_REDIRECT signal, parse its target URL
 *      and navigate there (so the receiving page sees the ?saved=1 /
 *      ?created=1 query param and can render its success banner).
 *      Otherwise reload the current URL.
 *   5. On mount in the new page, read sessionStorage and restore scroll
 *      using requestAnimationFrame so the layout has painted.
 */
const SCROLL_KEY = "save-form:scrollY";

interface NextRedirectErrorLike {
  digest?: string;
  message?: string;
}

/**
 * Detect Next's redirect signal and pull the target URL out of its
 * `digest` field. Next encodes the redirect as
 *   "NEXT_REDIRECT;<kind>;<url>;<statusCode>;<basePath>"
 * (semicolon-separated). We use the digest rather than importing
 * `isRedirectError` from `next/navigation` because that helper isn't
 * stable across Next versions — the digest format is what the
 * framework's own internals consume.
 */
function extractRedirectTarget(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const digest = (e as NextRedirectErrorLike).digest;
  if (typeof digest !== "string") return null;
  if (!digest.startsWith("NEXT_REDIRECT")) return null;
  const parts = digest.split(";");
  const url = parts[2];
  return url || null;
}

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
          let redirectTo: string | null = null;
          try {
            await action(formData);
          } catch (e) {
            redirectTo = extractRedirectTarget(e);
            if (!redirectTo) {
              // A real error (not a redirect signal). Let the user see
              // fresh state by reloading; the action will have logged
              // server-side. If we wanted to surface the error, this is
              // where we'd setState({ error: ... }).
              await fadeOut();
              window.location.reload();
              return;
            }
          }
          await fadeOut();
          if (redirectTo) {
            // Server action called redirect(). Navigate to its target so
            // the receiving page can read the ?saved=1 / ?created=1
            // query param and render the success banner. Using
            // location.assign (not reload) so the redirect target
            // actually loads.
            window.location.assign(redirectTo);
          } else {
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
