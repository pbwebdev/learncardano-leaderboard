"use client";

import { useState } from "react";

/**
 * Tap-to-copy referral code chip. Renders the code as a button below sm
 * (44x44 tap target via .tap-target) and falls back to a plain <code>
 * on desktop where keyboard-select is more natural anyway.
 *
 * Uses `navigator.clipboard.writeText`; if that's unavailable (older
 * browsers, http origins), surfaces a transient "select manually" hint
 * rather than failing silently.
 */
export function CopyRefCode({ code }: { code: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  async function onCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setCopied("ok");
      } else {
        setCopied("fail");
      }
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 1600);
  }

  const label =
    copied === "ok" ? "Copied!" : copied === "fail" ? "Copy failed — select manually" : "Tap to copy";

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy referral code ${code}`}
        className="tap-target inline-flex items-center rounded bg-[color:var(--bg-code)] px-3 py-1 font-mono text-base hover:bg-[color:var(--bg-elevated)] active:bg-[color:var(--bg-elevated)]"
      >
        {code}
      </button>
      <span
        className="text-xs text-[color:var(--fg-muted)]"
        aria-live="polite"
      >
        {label}
      </span>
    </span>
  );
}
