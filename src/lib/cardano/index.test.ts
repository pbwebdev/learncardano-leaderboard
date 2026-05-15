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
  getTxInfo: vi.fn(),
  getTxStatus: vi.fn(),
  getPoolInfo: vi.fn(),
  getDRepProfile: vi.fn(),
  formatAda: (v: string | null) => (v ? `${v}₳` : "—"),
}));

vi.mock("./blockfrost", () => ({
  getAccountInfo: vi.fn(),
  getAccountAssets: vi.fn(),
  getAccountHistory: vi.fn(),
  getDRepInfo: vi.fn(),
  getDRepMetadata: vi.fn(),
  getTxInfo: vi.fn(),
  getTxStatus: vi.fn(),
  getPoolInfo: vi.fn(),
}));

import * as koios from "./koios";
import * as blockfrost from "./blockfrost";
import { getAccountInfo, getDRepInfo, getTxInfo } from "./index";

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

  it("applies the same fallback policy for getDRepInfo and getTxInfo", async () => {
    const drep = { drep_id: "drep1abc", hex: "ab", has_script: false, drep_status: "registered", deposit: null, active: true, expires_epoch_no: null, amount: "100" };
    (koios.getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (blockfrost.getDRepInfo as ReturnType<typeof vi.fn>).mockResolvedValue(drep);
    expect(await getDRepInfo("drep1abc")).toEqual(drep);

    const tx = { hash: "txdeadbeef", block_hash: null, block_height: null, block_time: null, num_confirmations: 0, inputs: [], outputs: [], stake_addresses: [] };
    (koios.getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(tx);
    expect(await getTxInfo("txdeadbeef")).toEqual(tx);
    expect(blockfrost.getTxInfo).not.toHaveBeenCalled();
  });
});
