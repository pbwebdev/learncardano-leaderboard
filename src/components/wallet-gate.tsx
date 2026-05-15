"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Hook-based; only loaded in browser. The wallet lib touches window during
// import, so we keep it out of the SSR path.
const InnerGate = dynamic(() => import("./wallet-gate-inner"), {
  ssr: false,
  loading: () => null,
});

export function WalletGate({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <InnerGate fallback={fallback}>{children}</InnerGate>;
}
