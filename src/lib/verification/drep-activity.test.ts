import { describe, expect, it, vi, beforeEach } from "vitest";
import { bech32 } from "bech32";

vi.mock("@/lib/cardano", () => ({
  getCurrentEpoch: vi.fn(),
  getDRepInfo: vi.fn(),
}));

// Real stake-address module — it derives the DRep ID from the bech32 stake.
import { getCurrentEpoch, getDRepInfo } from "@/lib/cardano";
import { drepIdFromStakeAddress } from "@/lib/stake-address";
import {
  parseDRepRegisteredConfig,
  verifyDRepRegistered,
  DRepRegisteredConfigError,
} from "./drep-activity";

// Build a self-consistent mainnet stake address from a deterministic credential
// hash. bech32 with a valid checksum is required — decodeStakeAddress runs at
// verify time and rejects anything else.
function makeMainnetStake(seed = 0x42): string {
  const payload = new Uint8Array(29);
  payload[0] = 0xe1; // mainnet key-credential
  payload.set(new Uint8Array(28).fill(seed), 1);
  return bech32.encode("stake", bech32.toWords(payload), 200);
}

const STAKE = makeMainnetStake();

beforeEach(() => vi.clearAllMocks());

describe("verification/drep-activity: parseDRepRegisteredConfig", () => {
  it("accepts an empty config (no last-active constraint)", () => {
    expect(parseDRepRegisteredConfig({})).toEqual({ requireActiveLastEpochs: null });
    expect(parseDRepRegisteredConfig(null)).toEqual({ requireActiveLastEpochs: null });
  });
  it("accepts requireActiveLastEpochs as non-negative int", () => {
    expect(parseDRepRegisteredConfig({ requireActiveLastEpochs: 4 })).toEqual({
      requireActiveLastEpochs: 4,
    });
  });
  it("rejects negative / non-integer / out-of-range values", () => {
    expect(() => parseDRepRegisteredConfig({ requireActiveLastEpochs: -1 })).toThrow(DRepRegisteredConfigError);
    expect(() => parseDRepRegisteredConfig({ requireActiveLastEpochs: 1.5 })).toThrow(DRepRegisteredConfigError);
    expect(() => parseDRepRegisteredConfig({ requireActiveLastEpochs: 1000 })).toThrow(DRepRegisteredConfigError);
  });
});

describe("verification/drep-activity: verifyDRepRegistered", () => {
  it("verified when DRep is registered, not retired, not expired", async () => {
    const drepId = drepIdFromStakeAddress(STAKE);
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: drepId, hex: "ab", has_script: false, drep_status: "registered",
      deposit: null, active: true, expired: false, expires_epoch_no: 200, amount: "100",
      last_active_epoch: 99,
    });
    const r = await verifyDRepRegistered({ taskConfig: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when the DRep is retired", async () => {
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: "drep1x", hex: "ab", has_script: false, drep_status: "retired",
      deposit: null, active: false, expired: false, expires_epoch_no: null, amount: "0",
    });
    const r = await verifyDRepRegistered({ taskConfig: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "drep_retired" });
  });

  it("rejected when expired flag is true", async () => {
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: "drep1x", hex: "ab", has_script: false, drep_status: "registered",
      deposit: null, active: true, expired: true, expires_epoch_no: 50, amount: "0",
    });
    const r = await verifyDRepRegistered({ taskConfig: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "drep_expired" });
  });

  it("rejected when never registered (provider returns null)", async () => {
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyDRepRegistered({ taskConfig: {}, user: { stakeAddress: STAKE } });
    expect(r).toEqual({ status: "rejected", reason: "not_registered_as_drep" });
  });

  it("rejected when last_active_epoch is below the configured floor", async () => {
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: "drep1x", hex: "ab", has_script: false, drep_status: "registered",
      deposit: null, active: true, expired: false, expires_epoch_no: 200, amount: "100",
      last_active_epoch: 80,
    });
    (getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue({ epoch_no: 100, start_time: 1 });
    const r = await verifyDRepRegistered({
      taskConfig: { requireActiveLastEpochs: 5 },
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "drep_inactive_too_long" });
  });

  it("needs_review when the upstream tip is unavailable but the bound is set", async () => {
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: "drep1x", hex: "ab", has_script: false, drep_status: "registered",
      deposit: null, active: true, expired: false, expires_epoch_no: 200, amount: "100",
      last_active_epoch: 80,
    });
    (getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyDRepRegistered({
      taskConfig: { requireActiveLastEpochs: 5 },
      user: { stakeAddress: STAKE },
    });
    expect(r.status).toBe("needs_review");
  });
});
