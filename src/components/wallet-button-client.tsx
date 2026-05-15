"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

// When signed in: render a static chip + sign-out button. The session lives
// in the leaderboard_session cookie; the wallet connection is only needed
// to SIGN a new sign-in. Touching useCardano() here would auto-reconnect
// to the wallet on every mount, which makes Lace pop its Authorize-DApp
// dialog on every back/forward navigation (see GOTCHAS).
//
// When signed out: dynamic-import the heavy WalletButton (uses useCardano,
// requires window.cardano, must not SSR).
const Inner = dynamic(() => import("./wallet-button").then((m) => m.WalletButton), {
  ssr: false,
  loading: () => (
    <span className="inline-block h-8 w-32 rounded-[--radius-md] bg-[color:var(--bg-elevated)]" />
  ),
});

export function WalletButton({
  signedIn,
  stakeAddress,
}: {
  signedIn: boolean;
  stakeAddress?: string | null;
}) {
  if (signedIn && stakeAddress) {
    return <SignedInChip stakeAddress={stakeAddress} />;
  }
  return <Inner signedIn={signedIn} />;
}

function SignedInChip({ stakeAddress }: { stakeAddress: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      // Reload so server components pick up the cleared cookie. We deliberately
      // do NOT call wallet.disconnect() — that would require importing the
      // wallet hook and reintroduce the auto-reconnect popup loop. The wallet
      // extension's per-site authorization is harmless and the user can
      // revoke it from the extension if they want.
      window.location.assign("/");
    }
  }

  return (
    <div className="flex items-center gap-2 font-sans text-xs">
      <span className="rounded-full bg-[color:var(--status-green-bg)] px-2 py-0.5 text-[color:var(--status-green)]">
        ● Signed in
      </span>
      <span className="text-[color:var(--fg-muted)]">
        <code className="font-mono text-[color:var(--fg)]">
          {stakeAddress.slice(0, 12)}…{stakeAddress.slice(-6)}
        </code>
      </span>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-2 py-1 hover:bg-[color:var(--bg-elevated)] disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
