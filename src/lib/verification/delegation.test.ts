import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/cardano", () => ({
  getAccountInfo: vi.fn(),
  getCurrentEpoch: vi.fn(),
  getDRepInfo: vi.fn(),
}));

import { getAccountInfo, getCurrentEpoch, getDRepInfo } from "@/lib/cardano";
import {
  parsePoolDelegationConfig,
  parseDRepDelegationConfig,
  verifyDelegation,
  DelegationConfigError,
} from "./delegation";

const STAKE = "stake1u9testaddress";
const POOL = "pool1zuevzm3xlrhmwjw87ec38mzs02tlkwr9ujnz5va0fcwedyhrcr2";
const DREP = "drep1abcxyz0123456789abcdefghijklmnopqrstuvwxyz0123456";

const ACC_OK_POOL = {
  stake_address: STAKE,
  total_balance: "1",
  rewards_available: "0",
  delegated_pool: POOL,
  delegated_drep: null,
  registered: true,
  delegation_active_epoch_no: 100,
};

const ACC_OK_DREP = {
  ...ACC_OK_POOL,
  delegated_pool: null,
  delegated_drep: DREP,
};

beforeEach(() => vi.clearAllMocks());

describe("verification/delegation: config parsers", () => {
  it("parses a valid pool config with bech32 poolId", () => {
    expect(parsePoolDelegationConfig({ poolId: POOL })).toEqual({
      poolId: POOL,
      clawbackOnUndelegate: false,
    });
  });
  it("treats empty poolId as 'any pool'", () => {
    expect(parsePoolDelegationConfig({})).toEqual({ poolId: null, clawbackOnUndelegate: false });
    expect(parsePoolDelegationConfig({ poolId: "" })).toEqual({ poolId: null, clawbackOnUndelegate: false });
  });
  it("rejects non-bech32 poolId", () => {
    expect(() => parsePoolDelegationConfig({ poolId: "not_a_pool" })).toThrow(DelegationConfigError);
  });
  it("parses a valid drep config with mustBeActive", () => {
    expect(parseDRepDelegationConfig({ drepId: DREP, mustBeActive: true })).toEqual({
      drepId: DREP,
      mustBeActive: true,
      clawbackOnUndelegate: false,
    });
  });
  it("rejects non-bech32 drepId", () => {
    expect(() => parseDRepDelegationConfig({ drepId: "bad" })).toThrow(DelegationConfigError);
  });
});

describe("verification/delegation: pool_delegation verifier", () => {
  it("verified when account matches target pool", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC_OK_POOL);
    (getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyDelegation({
      taskType: "pool_delegation",
      taskConfig: { poolId: POOL },
      task: { startsAt: null },
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when delegated to a different pool", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC_OK_POOL);
    const r = await verifyDelegation({
      taskType: "pool_delegation",
      taskConfig: { poolId: "pool1abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop" },
      task: { startsAt: null },
      user: { stakeAddress: STAKE },
    });
    expect(r.status).toBe("rejected");
  });

  it("rejected when not delegated at all", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACC_OK_POOL, delegated_pool: null });
    const r = await verifyDelegation({
      taskType: "pool_delegation",
      taskConfig: {},
      task: { startsAt: null },
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "not_delegated_to_a_pool" });
  });

  it("needs_review when account info is unavailable upstream", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyDelegation({
      taskType: "pool_delegation",
      taskConfig: {},
      task: { startsAt: null },
      user: { stakeAddress: STAKE },
    });
    expect(r.status).toBe("needs_review");
  });

  it("rejected when delegation predates task.startsAt", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACC_OK_POOL,
      delegation_active_epoch_no: 50,
    });
    (getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue({
      epoch_no: 100,
      // mainnet 5-day epoch boundary in unix seconds
      start_time: 1_700_000_000,
    });
    // task starts 25 epochs (125 days) before current tip → required epoch ~75
    const startsAt = (1_700_000_000 - 25 * 432_000) * 1000;
    const r = await verifyDelegation({
      taskType: "pool_delegation",
      taskConfig: {},
      task: { startsAt },
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "delegated_before_task_started" });
  });
});

describe("verification/delegation: drep_delegation verifier", () => {
  it("verified when DRep matches and mustBeActive=false", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC_OK_DREP);
    const r = await verifyDelegation({
      taskType: "drep_delegation",
      taskConfig: { drepId: DREP },
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when delegated to a key DRep and config is 'any non-key'", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACC_OK_DREP,
      delegated_drep: "drep_always_abstain",
    });
    const r = await verifyDelegation({
      taskType: "drep_delegation",
      taskConfig: {},
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "delegated_to_key_drep" });
  });

  it("chains to getDRepInfo when mustBeActive=true and rejects expired", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC_OK_DREP);
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      drep_id: DREP, hex: "ab", has_script: false, drep_status: "registered",
      deposit: null, active: false, expired: true, expires_epoch_no: 90, amount: "0",
    });
    const r = await verifyDelegation({
      taskType: "drep_delegation",
      taskConfig: { drepId: DREP, mustBeActive: true },
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r).toEqual({ status: "rejected", reason: "drep_expired" });
  });

  it("needs_review when DRep info is unavailable", async () => {
    (getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC_OK_DREP);
    (getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyDelegation({
      taskType: "drep_delegation",
      taskConfig: { drepId: DREP, mustBeActive: true },
      task: {},
      user: { stakeAddress: STAKE },
    });
    expect(r.status).toBe("needs_review");
  });
});
