/**
 * Cardano data façade — Koios primary, Blockfrost fallback.
 *
 * Verifiers, page loaders, and admin tools import from this file ONLY.
 * Direct imports from `./koios` or `./blockfrost` bypass the fallback and
 * are forbidden by convention (see AGENTS.md § Cardano rules).
 *
 * Strategy per endpoint:
 *   - Try Koios first.
 *   - If Koios returns null OR throws, console.warn and fall back to Blockfrost.
 *   - Return whichever first non-null result we get; null if both providers fail.
 *
 * The DRep `expired` flag is canonical from Blockfrost — when Koios returns a
 * DRepInfo without an `expired` field, callers that need that exact flag should
 * either accept Koios's `active`/`drep_status` as a proxy, or explicitly call
 * the Blockfrost path. We keep the façade boring: same shape, same call site.
 */

import * as koios from "./koios";
import * as blockfrost from "./blockfrost";
import type {
  AccountAsset,
  AccountHistoryEntry,
  AccountInfo,
  DRepInfo,
  DRepMetadata,
  PoolInfo,
  TxInfo,
  TxStatus,
} from "./types";

export type { AccountAsset, AccountHistoryEntry, AccountInfo, DRepInfo, DRepMetadata, PoolInfo, TxInfo, TxStatus };
export { formatAda } from "./koios";

type Provider<T> = (...args: never[]) => Promise<T | null>;

async function withFallback<T>(
  label: string,
  primary: () => Promise<T | null>,
  fallback: () => Promise<T | null>,
): Promise<T | null> {
  try {
    const r = await primary();
    if (r) return r;
  } catch (e) {
    console.warn(`[cardano] koios.${label} threw, falling back to Blockfrost`, e);
  }
  try {
    return await fallback();
  } catch (e) {
    console.warn(`[cardano] blockfrost.${label} threw`, e);
    return null;
  }
}

export function getAccountInfo(stakeAddress: string): Promise<AccountInfo | null> {
  return withFallback("getAccountInfo",
    () => koios.getAccountInfo(stakeAddress),
    () => blockfrost.getAccountInfo(stakeAddress));
}

export function getAccountAssets(stakeAddress: string): Promise<AccountAsset[] | null> {
  return withFallback("getAccountAssets",
    () => koios.getAccountAssets(stakeAddress),
    () => blockfrost.getAccountAssets(stakeAddress));
}

export function getAccountHistory(stakeAddress: string): Promise<AccountHistoryEntry[] | null> {
  return withFallback("getAccountHistory",
    () => koios.getAccountHistory(stakeAddress),
    () => blockfrost.getAccountHistory(stakeAddress));
}

export function getDRepInfo(drepId: string): Promise<DRepInfo | null> {
  return withFallback("getDRepInfo",
    () => koios.getDRepInfo(drepId),
    () => blockfrost.getDRepInfo(drepId));
}

export function getDRepMetadata(drepId: string): Promise<DRepMetadata | null> {
  return withFallback("getDRepMetadata",
    () => koios.getDRepMetadata(drepId),
    () => blockfrost.getDRepMetadata(drepId));
}

export function getTxInfo(txHash: string): Promise<TxInfo | null> {
  return withFallback("getTxInfo",
    () => koios.getTxInfo(txHash),
    () => blockfrost.getTxInfo(txHash));
}

export function getTxStatus(txHash: string): Promise<TxStatus | null> {
  return withFallback("getTxStatus",
    () => koios.getTxStatus(txHash),
    () => blockfrost.getTxStatus(txHash));
}

export function getPoolInfo(poolId: string): Promise<PoolInfo | null> {
  return withFallback("getPoolInfo",
    () => koios.getPoolInfo(poolId),
    () => blockfrost.getPoolInfo(poolId));
}

/**
 * DRep profile (CIP-119) — only Koios has the metadata anchor fetch path.
 * Blockfrost exposes the metadata URL but not the resolved profile, so we
 * keep this Koios-only for now.
 */
export const getDRepProfile = koios.getDRepProfile;

// Tiny escape hatch for tests / specialised callers — DO NOT use in app code.
export const _providers = { koios, blockfrost };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Unused = Provider<unknown>;
