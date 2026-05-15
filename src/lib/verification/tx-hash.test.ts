import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/cardano", () => ({
  getTxInfo: vi.fn(),
}));

import { getTxInfo } from "@/lib/cardano";
import {
  parseTxSwapConfig,
  parseAssetPurchaseConfig,
  verifyTxHash,
  TxHashConfigError,
} from "./tx-hash";

const STAKE = "stake1u9testaddress";
const TX = "a".repeat(64);
const SCRIPT = "addr1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POLICY = "f".repeat(56);
const ASSET = "ad4d4d"; // "ADMM" hex

beforeEach(() => vi.clearAllMocks());

const baseTx = (over: Partial<Parameters<typeof Object>[0]> = {}) => ({
  hash: TX,
  block_hash: "blk",
  block_height: 1,
  block_time: 1_700_000_000,
  num_confirmations: 5,
  inputs: [{ address: "addr1usr", stake_address: STAKE, amount: [{ unit: "lovelace", quantity: "10000000" }] }],
  outputs: [
    { address: SCRIPT, stake_address: null, amount: [{ unit: "lovelace", quantity: "5000000" }] },
    { address: "addr1back", stake_address: STAKE, amount: [{ unit: "lovelace", quantity: "4000000" }] },
  ],
  stake_addresses: [STAKE],
  ...over,
});

describe("verification/tx-hash: config parsers", () => {
  it("parses a valid tx_swap config", () => {
    expect(parseTxSwapConfig({ scriptAddresses: [SCRIPT], minAdaIn: 1 })).toEqual({
      scriptAddresses: [SCRIPT],
      minAdaIn: 1,
    });
  });
  it("rejects empty scriptAddresses", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [] })).toThrow(TxHashConfigError);
  });
  it("rejects non-bech32 script address", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: ["not_addr"] })).toThrow(TxHashConfigError);
  });
  it("parses a valid asset_purchase config", () => {
    expect(parseAssetPurchaseConfig({ policyId: POLICY, assetName: ASSET, minQuantity: 2 })).toEqual({
      policyId: POLICY,
      assetName: ASSET,
      minQuantity: 2,
    });
  });
  it("rejects bad policyId", () => {
    expect(() => parseAssetPurchaseConfig({ policyId: "short" })).toThrow(TxHashConfigError);
  });
});

describe("verification/tx-hash: verifyTxHash dispatch", () => {
  it("rejects invalid tx hash shape", async () => {
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: "not_a_hash" },
    });
    expect(r).toEqual({ status: "rejected", reason: "invalid_tx_hash" });
  });

  it("needs_review when tx is unknown / unconfirmed (provider null)", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r.status).toBe("needs_review");
  });

  it("needs_review when num_confirmations is 0", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx({ num_confirmations: 0 }));
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "unconfirmed" });
  });
});

describe("verification/tx-hash: tx_swap verifier", () => {
  it("verified for a tx involving the user that hits the script", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx());
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when the tx doesn't involve the user", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx({
      inputs: [{ address: "addr1other", stake_address: "stake1other", amount: [] }],
      outputs: [{ address: SCRIPT, stake_address: null, amount: [] }],
      stake_addresses: ["stake1other"],
    }));
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "tx_not_owned_by_user" });
  });

  it("rejected when no output goes to a configured script address", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx({
      outputs: [{ address: "addr1elsewhere", stake_address: STAKE, amount: [] }],
    }));
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "no_output_to_script_address" });
  });

  it("rejected when user's input lovelace is below minAdaIn", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx());
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], minAdaIn: 100 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "user_input_below_min_ada" });
  });

  it("rejected when tx pre-dates task.startsAt", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx());
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT] },
      task: { startsAt: (1_700_000_000 + 1000) * 1000 },
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "tx_before_task_started" });
  });
});

describe("verification/tx-hash: asset_purchase verifier", () => {
  const assetTxBase = baseTx({
    outputs: [
      {
        address: "addr1userownable",
        stake_address: STAKE,
        amount: [
          { unit: "lovelace", quantity: "2000000" },
          { unit: `${POLICY}${ASSET}`, quantity: "3" },
        ],
      },
    ],
  });

  it("verified when output to user holds the asset with quantity >= min", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(assetTxBase);
    const r = await verifyTxHash({
      taskType: "asset_purchase",
      taskConfig: { policyId: POLICY, assetName: ASSET, minQuantity: 2 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("rejected when policy matches but assetName doesn't", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(assetTxBase);
    const r = await verifyTxHash({
      taskType: "asset_purchase",
      taskConfig: { policyId: POLICY, assetName: "deadbeef", minQuantity: 1 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "asset_quantity_below_min" });
  });

  it("rejected when quantity is below the configured minimum", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(assetTxBase);
    const r = await verifyTxHash({
      taskType: "asset_purchase",
      taskConfig: { policyId: POLICY, assetName: ASSET, minQuantity: 99 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "asset_quantity_below_min" });
  });

  it("verified with assetName unset = any asset under that policy", async () => {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(assetTxBase);
    const r = await verifyTxHash({
      taskType: "asset_purchase",
      taskConfig: { policyId: POLICY },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });
});
