"use client";

import { useEffect, useState } from "react";
import { useCardano } from "@cardano-foundation/cardano-connect-with-wallet";
import { NetworkType } from "@cardano-foundation/cardano-connect-with-wallet-core";

declare global {
  interface Window {
    cardano?: Record<string, { apiVersion?: string; name?: string; icon?: string }>;
  }
}

type Status = "idle" | "signing" | "verifying" | "error";

/**
 * CIP-30 wallet sign-in button. Lifted from the DRep Dashboard, with the
 * CIP-95 / DRep-pubkey block removed — the leaderboard identifies users by
 * stake address (bech32 stake1...) only.
 *
 * Flow:
 *   1. Fetch a nonce + message template from /api/auth/nonce.
 *   2. Ask the wallet to signMessage(template) — no DRep suffix appended.
 *   3. POST {signature, key, message, nonce, stake_address_hex, stake_address_bech32}
 *      to /api/auth/verify. Server sets the session cookie on success.
 *   4. Reload so server components pick up the cookie.
 */
export function WalletButton({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const {
    isEnabled,
    isConnected,
    enabledWallet,
    stakeAddress,
    signMessage,
    connect,
    disconnect,
  } = useCardano({ limitNetwork: NetworkType.MAINNET });

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined" && window.cardano) {
      const names = Object.keys(window.cardano).filter((k) => {
        const w = (window.cardano as Record<string, unknown>)[k] as { apiVersion?: string } | undefined;
        return !!w?.apiVersion;
      });
      setInstalled(names);
    }
  }, []);

  async function signIn() {
    if (!stakeAddress) return;
    setStatus("signing");
    setError(null);
    try {
      // 1. Get nonce.
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) throw new Error("could not fetch nonce");
      const { nonce, message_template } = (await nonceRes.json()) as {
        nonce: string;
        message_template: string;
      };

      // 2. Open the wallet just enough to read the raw reward address (hex).
      const walletConn = await openWallet(enabledWallet);
      if (!walletConn) throw new Error("could not enable wallet");
      const { stakeHex } = walletConn;
      const message = message_template; // no DRep suffix

      // 3. Sign via CIP-30.
      const signed = await new Promise<{ signature: string; key: string }>((resolve, reject) => {
        signMessage(
          message,
          (sig: string, ck?: string) => resolve({ signature: sig, key: ck ?? "" }),
          (err?: unknown) => reject(err ?? new Error("sign cancelled")),
        );
      });

      // 4. Verify on server.
      setStatus("verifying");
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...signed,
          message,
          nonce,
          stake_address_hex: stakeHex,
          stake_address_bech32: stakeAddress,
        }),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `verify failed (${verifyRes.status})`);
      }

      window.location.reload();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    try {
      await disconnect();
    } catch {
      // ignore — wallet may already be disconnected
    }
    window.location.reload();
  }

  if (!mounted) {
    return <span className="inline-block h-8 w-32 rounded-[--radius-md] bg-[color:var(--bg-elevated)]" />;
  }

  if (signedIn) {
    return (
      <div className="flex items-center gap-2 font-sans text-xs">
        <span className="rounded-full bg-[color:var(--status-green-bg)] px-2 py-0.5 text-[color:var(--status-green)]">
          ● Signed in
        </span>
        {stakeAddress && (
          <span className="text-[color:var(--fg-muted)]">
            {enabledWallet}:{" "}
            <code className="font-mono text-[color:var(--fg)]">
              {stakeAddress.slice(0, 12)}…{stakeAddress.slice(-6)}
            </code>
          </span>
        )}
        <button
          type="button"
          onClick={signOut}
          className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-2 py-1 hover:bg-[color:var(--bg-elevated)]"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (isConnected && isEnabled && stakeAddress) {
    return (
      <div className="flex items-center gap-2 font-sans text-xs">
        <span className="text-[color:var(--fg-muted)]">
          {enabledWallet}:{" "}
          <code className="font-mono text-[color:var(--fg)]">
            {stakeAddress.slice(0, 12)}…{stakeAddress.slice(-6)}
          </code>
        </span>
        <button
          type="button"
          onClick={signIn}
          disabled={status === "signing" || status === "verifying"}
          className="rounded-[--radius-md] bg-[color:var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[color:var(--accent-primary-strong)] disabled:opacity-50"
        >
          {status === "signing" ? "Sign in wallet…" : status === "verifying" ? "Verifying…" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded-[--radius-md] border border-[color:var(--border-strong)] px-2 py-1 hover:bg-[color:var(--bg-elevated)]"
        >
          Disconnect
        </button>
        {error && (
          <span role="alert" className="text-[color:var(--status-red)]">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-[--radius-md] border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-1.5 font-sans text-sm hover:bg-[color:var(--bg-elevated)]"
      >
        Connect wallet
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-[--radius-md] border border-[color:var(--border)] bg-[color:var(--surface)] p-2 shadow-[var(--shadow-card)] font-sans text-sm">
          {installed.length === 0 ? (
            <div className="px-2 py-2 text-xs text-[color:var(--fg-muted)]">
              No CIP-30 wallet found. Install Eternl, Lace, Nami, Typhon, or another Cardano wallet.
            </div>
          ) : (
            installed.map((name) => (
              <button
                key={name}
                type="button"
                onClick={async () => {
                  setOpen(false);
                  try {
                    await connect(name);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                className="block w-full rounded px-2 py-1.5 text-left capitalize hover:bg-[color:var(--bg-elevated)]"
              >
                {name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type WalletApi = {
  getRewardAddresses: () => Promise<string[]>;
};

/**
 * Re-enable the wallet that useCardano connected and grab the raw reward
 * address (hex). No CIP-95 extension — leaderboard identity is the stake key
 * directly, not a separate DRep credential.
 */
async function openWallet(
  walletName: string | null,
): Promise<{ api: WalletApi; stakeHex: string } | null> {
  if (!walletName) return null;
  const wallet = (window.cardano as Record<string, { enable?: () => Promise<unknown> }> | undefined)?.[walletName];
  if (!wallet?.enable) return null;
  const api = (await wallet.enable()) as WalletApi;
  const hexes = await api.getRewardAddresses();
  const stakeHex = hexes[0];
  if (!stakeHex) return null;
  return { api, stakeHex };
}
