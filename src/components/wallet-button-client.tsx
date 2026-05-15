"use client";

import dynamic from "next/dynamic";

// CIP-30 wallets live on `window.cardano`, so the inner component cannot run
// during SSR. Dynamic-import with ssr:false; the parent (layout) passes a
// server-known `signedIn` flag through.
const Inner = dynamic(() => import("./wallet-button").then((m) => m.WalletButton), {
  ssr: false,
  loading: () => (
    <span className="inline-block h-8 w-32 rounded-[--radius-md] bg-[color:var(--bg-elevated)]" />
  ),
});

export function WalletButton({ signedIn }: { signedIn: boolean }) {
  return <Inner signedIn={signedIn} />;
}
