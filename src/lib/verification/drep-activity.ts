/**
 * `drep_registered` verifier.
 *
 * The user "is a DRep" — derive their CIP-105 DRep ID from the stake
 * credential, fetch `getDRepInfo`, require `retired === false` AND
 * `expired === false`. Optional stricter check via `requireActiveLastEpochs`.
 *
 * Façade-only — `drep_status === 'retired'` is the canonical retired flag
 * (both Koios and Blockfrost surface a retired flavour), `expired` is the
 * authoritative protocol flag from Blockfrost (preferred by the façade).
 */

import { getCurrentEpoch, getDRepInfo } from "@/lib/cardano";
import { drepIdFromStakeAddress } from "@/lib/stake-address";
import type { VerifierResult } from "./manual";

export interface DRepRegisteredConfig {
  // When set, also require `last_active_epoch >= currentEpoch - N`. A loose
  // upper bound on staleness — useful for ongoing "DRep is an active
  // participant" tasks. Omit for "ever registered, not retired" style.
  requireActiveLastEpochs: number | null;
}

export class DRepRegisteredConfigError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(`drep_registered_config:${field}:${message}`);
    this.name = "DRepRegisteredConfigError";
    this.field = field;
  }
}

export function parseDRepRegisteredConfig(raw: unknown): DRepRegisteredConfig {
  if (raw == null || typeof raw !== "object") {
    // Empty config is valid — defaults are fine for the "ever-registered" case.
    return { requireActiveLastEpochs: null };
  }
  const obj = raw as Record<string, unknown>;
  let n: number | null = null;
  if (obj.requireActiveLastEpochs !== undefined && obj.requireActiveLastEpochs !== null) {
    const v = obj.requireActiveLastEpochs;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      throw new DRepRegisteredConfigError("requireActiveLastEpochs", "must be a non-negative integer <= 100");
    }
    n = v;
  }
  return { requireActiveLastEpochs: n };
}

export interface DRepRegisteredVerifyOpts {
  taskConfig: unknown;
  user: { stakeAddress: string };
}

export async function verifyDRepRegistered(opts: DRepRegisteredVerifyOpts): Promise<VerifierResult> {
  const cfg = parseDRepRegisteredConfig(opts.taskConfig);
  let drepId: string;
  try {
    drepId = drepIdFromStakeAddress(opts.user.stakeAddress);
  } catch (e) {
    // Script-credential or malformed stake — should never happen for a
    // signed-in user, but reject defensively rather than throw (which
    // would trigger queue retries that would all fail the same way).
    return { status: "rejected", reason: `bad_stake_address:${(e as Error).message}` };
  }

  const drep = await getDRepInfo(drepId);
  if (!drep) {
    // Two distinct failure modes share this null:
    //   1. Both providers down → needs_review (queue retry).
    //   2. The DRep ID has never been registered → rejected.
    // We can't tell them apart from a null return. Treat as rejected and
    // surface a specific reason — if Peter sees this on a user he knows is
    // a real DRep, the admin can manually re-verify; the cron path will
    // also pick it up on next sweep.
    return { status: "rejected", reason: "not_registered_as_drep" };
  }

  if (drep.drep_status === "retired") {
    return { status: "rejected", reason: "drep_retired" };
  }
  if (drep.expired === true) {
    return { status: "rejected", reason: "drep_expired" };
  }
  // When the provider doesn't surface `expired`, fall back to `active`.
  if (drep.expired === undefined && drep.active === false) {
    return { status: "rejected", reason: "drep_inactive" };
  }

  if (cfg.requireActiveLastEpochs != null) {
    if (drep.last_active_epoch == null) {
      // We can't enforce the bound without provider data. Treat as needs_review
      // so the cron retry can catch it on a future sweep — fail-closed.
      return { status: "needs_review", reason: "last_active_epoch_unavailable" };
    }
    const tip = await getCurrentEpoch();
    if (!tip) return { status: "needs_review", reason: "epoch_unavailable" };
    const floor = tip.epoch_no - cfg.requireActiveLastEpochs;
    if (drep.last_active_epoch < floor) {
      return { status: "rejected", reason: "drep_inactive_too_long" };
    }
  }

  return { status: "verified" };
}
