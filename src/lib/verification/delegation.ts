/**
 * Pool + DRep delegation verifiers.
 *
 * Both share the same flow:
 *   1. Re-parse `taskConfig` (zero-trust at verify time, even though admin
 *      save also validates — see CLAUDE.md § Task config validation).
 *   2. Call the Cardano façade for `getAccountInfo(user.stakeAddress)`.
 *   3. Compare delegated_pool / delegated_drep against the config.
 *   4. (pool only) Tx-age guard: if the user's current delegation became
 *      active in an epoch BEFORE the task starts, reject — they delegated
 *      before the task existed, which doesn't count.
 *   5. (drep, optional) When `mustBeActive` is set, chain to `getDRepInfo`
 *      and require `expired === false`.
 *
 * Façade-only — never imports from `./koios` or `./blockfrost`.
 */

import { getAccountInfo, getCurrentEpoch, getDRepInfo } from "@/lib/cardano";
import type { VerifierResult } from "./manual";

// ---------- Config parsers ----------

export interface PoolDelegationConfig {
  poolId: string | null;            // null = "any pool"
  clawbackOnUndelegate: boolean;    // checked by cron handler, not the verifier
}

export interface DRepDelegationConfig {
  drepId: string | null;            // null = "any DRep" (excluding key DReps abstain/no-confidence)
  mustBeActive: boolean;
  clawbackOnUndelegate: boolean;
}

export class DelegationConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`delegation_config:${field}:${message}`);
    this.name = "DelegationConfigError";
    this.field = field;
  }
}

export function parsePoolDelegationConfig(raw: unknown): PoolDelegationConfig {
  if (raw == null || typeof raw !== "object") {
    throw new DelegationConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  let poolId: string | null = null;
  if (obj.poolId !== undefined && obj.poolId !== null && obj.poolId !== "") {
    if (typeof obj.poolId !== "string") throw new DelegationConfigError("poolId", "must be a string");
    if (!/^pool1[0-9a-z]+$/.test(obj.poolId)) {
      throw new DelegationConfigError("poolId", "must be a bech32 pool ID (pool1...)");
    }
    poolId = obj.poolId;
  }
  return {
    poolId,
    clawbackOnUndelegate: coerceBool(obj.clawbackOnUndelegate, false, "clawbackOnUndelegate"),
  };
}

export function parseDRepDelegationConfig(raw: unknown): DRepDelegationConfig {
  if (raw == null || typeof raw !== "object") {
    throw new DelegationConfigError("root", "must be an object");
  }
  const obj = raw as Record<string, unknown>;
  let drepId: string | null = null;
  if (obj.drepId !== undefined && obj.drepId !== null && obj.drepId !== "") {
    if (typeof obj.drepId !== "string") throw new DelegationConfigError("drepId", "must be a string");
    if (!/^drep1[0-9a-z]+$/.test(obj.drepId)) {
      throw new DelegationConfigError("drepId", "must be a bech32 drep ID (drep1...)");
    }
    drepId = obj.drepId;
  }
  return {
    drepId,
    mustBeActive: coerceBool(obj.mustBeActive, false, "mustBeActive"),
    clawbackOnUndelegate: coerceBool(obj.clawbackOnUndelegate, false, "clawbackOnUndelegate"),
  };
}

function coerceBool(v: unknown, fallback: boolean, field: string): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new DelegationConfigError(field, "must be boolean");
}

// ---------- Verifier surface ----------

export interface DelegationVerifyOpts {
  taskType: "pool_delegation" | "drep_delegation";
  taskConfig: unknown;
  task: { startsAt?: Date | number | null };
  user: { stakeAddress: string };
}

export async function verifyDelegation(opts: DelegationVerifyOpts): Promise<VerifierResult> {
  return opts.taskType === "pool_delegation"
    ? verifyPoolDelegation(opts)
    : verifyDRepDelegation(opts);
}

async function verifyPoolDelegation(opts: DelegationVerifyOpts): Promise<VerifierResult> {
  const cfg = parsePoolDelegationConfig(opts.taskConfig);
  const account = await getAccountInfo(opts.user.stakeAddress);
  if (!account) {
    // Both providers failed. Distinct from "no delegation" — caller's queue
    // consumer should retry per the standard policy.
    return { status: "needs_review", reason: "account_info_unavailable" };
  }
  if (!account.delegated_pool) {
    return { status: "rejected", reason: "not_delegated_to_a_pool" };
  }
  if (cfg.poolId && account.delegated_pool !== cfg.poolId) {
    return { status: "rejected", reason: "wrong_pool" };
  }
  // Tx-age guard: enforce `delegation_active_epoch_no` >= epoch at startsAt.
  // Both providers may omit `delegation_active_epoch_no` (older Koios rows,
  // or accounts with no live delegation) — we skip the guard when null
  // rather than spuriously rejecting. The cron clawback path covers the
  // un-delegation case downstream.
  const startEpoch = await epochAtMillis(opts.task.startsAt);
  if (
    startEpoch != null &&
    account.delegation_active_epoch_no != null &&
    account.delegation_active_epoch_no < startEpoch
  ) {
    return { status: "rejected", reason: "delegated_before_task_started" };
  }
  return { status: "verified" };
}

async function verifyDRepDelegation(opts: DelegationVerifyOpts): Promise<VerifierResult> {
  const cfg = parseDRepDelegationConfig(opts.taskConfig);
  const account = await getAccountInfo(opts.user.stakeAddress);
  if (!account) {
    return { status: "needs_review", reason: "account_info_unavailable" };
  }
  if (!account.delegated_drep) {
    return { status: "rejected", reason: "not_delegated_to_a_drep" };
  }
  // "Any non-key DRep" mode (cfg.drepId is null) excludes the two protocol-
  // defined key DReps (abstain, no-confidence) so the task means "engaged
  // with the DRep ecosystem", not "delegated at all".
  if (!cfg.drepId) {
    if (account.delegated_drep === "drep_always_abstain" || account.delegated_drep === "drep_always_no_confidence") {
      return { status: "rejected", reason: "delegated_to_key_drep" };
    }
  } else if (account.delegated_drep !== cfg.drepId) {
    return { status: "rejected", reason: "wrong_drep" };
  }
  if (cfg.mustBeActive) {
    const drep = await getDRepInfo(account.delegated_drep);
    if (!drep) return { status: "needs_review", reason: "drep_info_unavailable" };
    if (drep.expired === true) {
      return { status: "rejected", reason: "drep_expired" };
    }
    // When the provider doesn't surface `expired`, fall back to `active`.
    if (drep.expired === undefined && drep.active === false) {
      return { status: "rejected", reason: "drep_inactive" };
    }
  }
  return { status: "verified" };
}

/**
 * Resolve an epoch number from a unix-ms timestamp by asking the Cardano
 * façade for the current epoch and back-calculating. Returns null if we
 * can't get the current epoch (the verifier then skips the guard).
 *
 * Cardano mainnet epochs are 432_000 seconds (5 days). The genesis epoch
 * boundary is well-known. We anchor on the current tip's epoch + start
 * time (Blockfrost surfaces `start_time`; Koios may not), and step
 * backwards in 5-day chunks.
 */
async function epochAtMillis(startsAt: Date | number | null | undefined): Promise<number | null> {
  const startMs = toMillis(startsAt);
  if (startMs == null) return null;
  const tip = await getCurrentEpoch();
  if (!tip) return null;
  // If we don't have a start_time from the provider, use the current epoch
  // as a lower bound — any past-tense delegation has activated before this
  // epoch, so the guard becomes effectively "delegated_active_epoch_no >=
  // current_epoch" which is too strict. Skip in that case.
  if (tip.start_time == null) return null;
  const tipEpochStartMs = tip.start_time * 1000;
  const EPOCH_MS = 432_000_000;
  // If the task starts in the future, the guard is moot — return the current
  // epoch as a floor (any delegation already active will pass).
  if (startMs >= tipEpochStartMs) return tip.epoch_no;
  const epochsBack = Math.ceil((tipEpochStartMs - startMs) / EPOCH_MS);
  return tip.epoch_no - epochsBack;
}

function toMillis(d: Date | number | null | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  return d.getTime();
}
