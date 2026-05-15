"use client";

import { useCardano } from "@cardano-foundation/cardano-connect-with-wallet";
import { NetworkType } from "@cardano-foundation/cardano-connect-with-wallet-core";

export default function WalletGateInner({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isConnected } = useCardano({ limitNetwork: NetworkType.MAINNET });
  if (!isConnected) {
    return (
      <>
        {fallback ?? (
          <div className="rounded-[--radius-md] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)] p-5 font-sans text-sm text-[color:var(--fg-muted)]">
            Connect your wallet from the header to view the leaderboard.
          </div>
        )}
      </>
    );
  }
  return <>{children}</>;
}
