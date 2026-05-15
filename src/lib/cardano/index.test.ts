import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {} }),
}));

// Mock the two provider modules. Each test wires up koios + blockfrost
// behaviours and asserts the façade picks the right one.
vi.mock("./koios", () => ({
  getAccountInfo: vi.fn(),
  getAccountAssets: vi.fn(),
  getAccountHistory: vi.fn(),
  getDRepInfo: vi.fn(),
  getDRepMetadata: vi.fn(),
  getDRepVotes: vi.fn(),
  getTxInfo: vi.fn(),
  getTxStatus: vi.fn(),
  getPoolInfo: vi.fn(),
  getCurrentEpoch: vi.fn(),
  getDRepProfile: vi.fn(),
  formatAda: (v: string | null) => (v ? `${v}₳` : "—"),
}));

vi.mock("./blockfrost", () => ({
  getAccountInfo: vi.fn(),
  getAccountAssets: vi.fn(),
  getAccountHistory: vi.fn(),
  getDRepInfo: vi.fn(),
  getDRepMetadata: vi.fn(),
  getDRepVotes: vi.fn(),
  getTxInfo: vi.fn(),
  getTxStatus: vi.fn(),
  getPoolInfo: vi.fn(),
  getCurrentEpoch: vi.fn(),
}));

import * as koios from "./koios";
import * as blockfrost from "./blockfrost";
import { getAccountInfo, getCurrentEpoch, getDRepInfo, getDRepVotes, getTxInfo } from "./index";

const STAKE = "stake1u9testaddress";
const ACC = {
  stake_address: STAKE,
  total_balance: "100",
  rewards_available: "0",
  delegated_pool: null,
  delegated_drep: null,
  registered: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cardano façade fallback", () => {
  it("returns Koios result when Koios succeeds (no Blockfrost call)", async () => {
    (koios.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    const r = await getAccountInfo(STAKE);
    expect(r).toEqual(ACC);
    expect(blockfrost.getAccountInfo).not.toHaveBeenCalled();
  });

  it("falls back to Blockfrost when Koios returns null", async () => {
    (koios.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (blockfrost.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    const r = await getAccountInfo(STAKE);
    expect(r).toEqual(ACC);
    expect(blockfrost.getAccountInfo).toHaveBeenCalledOnce();
  });

  it("falls back to Blockfrost when Koios throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (koios.getAccountInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("koios down"));
    (blockfrost.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(ACC);
    const r = await getAccountInfo(STAKE);
    expect(r).toEqual(ACC);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when both providers fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (koios.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (blockfrost.getAccountInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await getAccountInfo(STAKE)).toBeNull();
    warn.mockRestore();
  });

  it("getDRepInfo prefers Blockfrost (authoritative `expired` flag)", async () => {
    const drep = { drep_id: "drep1abc", hex: "ab", has_script: false, drep_status: "registered", deposit: null, active: true, expired: false, expires_epoch_no: null, amount: "100" };
    (blockfrost.getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(drep);
    expect(await getDRepInfo("drep1abc")).toEqual(drep);
    expect(koios.getDRepInfo).not.toHaveBeenCalled();
  });

  it("getDRepInfo falls back to Koios when Blockfrost returns null", async () => {
    const drep = { drep_id: "drep1abc", hex: "ab", has_script: false, drep_status: "registered", deposit: null, active: true, expires_epoch_no: null, amount: "100" };
    (blockfrost.getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (koios.getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(drep);
    expect(await getDRepInfo("drep1abc")).toEqual(drep);
  });

  it("getTxInfo prefers Koios", async () => {
    const tx = { hash: "txdeadbeef", block_hash: null, block_height: null, block_time: null, num_confirmations: 0, inputs: [], outputs: [], stake_addresses: [] };
    (koios.getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(tx);
    expect(await getTxInfo("txdeadbeef")).toEqual(tx);
    expect(blockfrost.getTxInfo).not.toHaveBeenCalled();
  });

  it("getCurrentEpoch falls back to Blockfrost on Koios failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (koios.getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (blockfrost.getCurrentEpoch as ReturnType<typeof vi.fn>).mockResolvedValue({ epoch_no: 500, start_time: 100 });
    expect(await getCurrentEpoch()).toEqual({ epoch_no: 500, start_time: 100 });
    warn.mockRestore();
  });

  it("getDRepVotes uses Koios primary", async () => {
    const votes = [{ proposal_tx_hash: "a".repeat(64), proposal_index: 0, vote: "yes", block_time: null }];
    (koios.getDRepVotes as ReturnType<typeof vi.fn>).mockResolvedValue(votes);
    expect(await getDRepVotes("drep1abc")).toEqual(votes);
    expect(blockfrost.getDRepVotes).not.toHaveBeenCalled();
  });
});
