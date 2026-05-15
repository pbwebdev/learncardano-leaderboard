"use client";

import { useEffect, useState } from "react";

/**
 * Renders an ISO timestamp using the visitor's locale + timezone. SSR returns
 * the raw ISO so HTML hydration is identical; the client effect swaps it.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(iso.slice(0, 16).replace("T", " "));
  useEffect(() => {
    try {
      const d = new Date(iso);
      setText(d.toLocaleString());
    } catch {
      // keep the ISO fallback
    }
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
