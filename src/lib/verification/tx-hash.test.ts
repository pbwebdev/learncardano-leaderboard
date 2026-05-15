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
      requiredScriptHashes: null,
      requiredRedeemerTag: null,
      requiredRedeemerConstructor: null,
      requiredMintedAsset: null,
      requiredReferenceScriptHash: null,
      requiredOutputDatumHash: null,
    });
  });

  it("parses all strict-verification fields and lowercases hex", () => {
    const SH = "a".repeat(56);
    const RSH = "b".repeat(56);
    const DH = "c".repeat(64);
    const out = parseTxSwapConfig({
      scriptAddresses: [SCRIPT],
      requiredScriptHashes: [SH.toUpperCase()],
      requiredRedeemerTag: "Spend",
      requiredRedeemerConstructor: 0,
      requiredMintedAsset: { policyId: POLICY.toUpperCase(), assetName: "AD4D4D", minQuantity: 2 },
      requiredReferenceScriptHash: RSH.toUpperCase(),
      requiredOutputDatumHash: DH.toUpperCase(),
    });
    expect(out.requiredScriptHashes).toEqual([SH]);
    expect(out.requiredRedeemerTag).toBe("spend");
    expect(out.requiredRedeemerConstructor).toBe(0);
    expect(out.requiredMintedAsset).toEqual({ policyId: POLICY, assetName: "ad4d4d", minQuantity: 2 });
    expect(out.requiredReferenceScriptHash).toBe(RSH);
    expect(out.requiredOutputDatumHash).toBe(DH);
  });

  it("rejects malformed requiredScriptHashes", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [SCRIPT], requiredScriptHashes: ["zz"] })).toThrow(TxHashConfigError);
  });
  it("rejects unknown redeemer tag", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [SCRIPT], requiredRedeemerTag: "nope" })).toThrow(TxHashConfigError);
  });
  it("rejects negative redeemer constructor", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [SCRIPT], requiredRedeemerConstructor: -1 })).toThrow(TxHashConfigError);
  });
  it("rejects wrong-length requiredOutputDatumHash", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [SCRIPT], requiredOutputDatumHash: "abc" })).toThrow(TxHashConfigError);
  });
  it("rejects requiredMintedAsset with bad policyId", () => {
    expect(() => parseTxSwapConfig({ scriptAddresses: [SCRIPT], requiredMintedAsset: { policyId: "short" } })).toThrow(TxHashConfigError);
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

describe("verification/tx-hash: tx_swap strict verification", () => {
  const SH = "a".repeat(56);
  const REF_SH = "b".repeat(56);
  const DH = "c".repeat(64);
  const MINT_PID = "d".repeat(56);
  const MINT_NAME = "deadbeef";

  function mockTx(extra: Record<string, unknown>) {
    (getTxInfo as ReturnType<typeof vi.fn>).mockResolvedValue(baseTx(extra));
  }

  it("script_hash_not_present when no plutusContract matches", async () => {
    mockTx({ plutusContracts: [{ scriptHash: "ff".repeat(28) }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredScriptHashes: [SH] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "script_hash_not_present" });
  });

  it("verified when plutusContract matches a requiredScriptHash", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredScriptHashes: [SH] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review when plutusContracts is missing", async () => {
    mockTx({}); // baseTx has no plutusContracts
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredScriptHashes: [SH] },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r.status).toBe("needs_review");
    expect(r.reason).toMatch(/^provider_data_missing:/);
  });

  it("redeemer_tag_mismatch", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH, redeemerTag: "mint" }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerTag: "spend" },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "redeemer_tag_mismatch" });
  });

  it("verified when redeemer tag matches", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH, redeemerTag: "spend" }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerTag: "spend" },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review provider_data_missing:redeemerTag when contract present but tag absent", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerTag: "spend" },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "provider_data_missing:redeemerTag" });
  });

  it("redeemer_constructor_mismatch", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH, redeemerConstructor: 1 }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerConstructor: 0 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "redeemer_constructor_mismatch" });
  });

  it("verified when redeemer constructor matches", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH, redeemerConstructor: 0 }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerConstructor: 0 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review provider_data_missing:redeemerConstructor when blockfrost-style undecoded", async () => {
    mockTx({ plutusContracts: [{ scriptHash: SH }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredRedeemerConstructor: 0 },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "provider_data_missing:redeemerConstructor" });
  });

  it("minted_asset_not_present", async () => {
    mockTx({ mintedAssets: [] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredMintedAsset: { policyId: MINT_PID, assetName: MINT_NAME } },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "minted_asset_not_present" });
  });

  it("verified when a matching mint is present", async () => {
    mockTx({ mintedAssets: [{ policyId: MINT_PID, assetName: MINT_NAME, quantity: 5 }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredMintedAsset: { policyId: MINT_PID, assetName: MINT_NAME, minQuantity: 1 } },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review provider_data_missing:mintedAssets when undefined", async () => {
    mockTx({}); // no mintedAssets key
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredMintedAsset: { policyId: MINT_PID } },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "provider_data_missing:mintedAssets" });
  });

  it("reference_script_not_attached", async () => {
    mockTx({ referenceInputs: [] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredReferenceScriptHash: REF_SH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "reference_script_not_attached" });
  });

  it("verified when reference script matches", async () => {
    mockTx({ referenceInputs: [{ txHash: "xx", outputIndex: 0, scriptHash: REF_SH }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredReferenceScriptHash: REF_SH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review provider_data_missing:referenceInputs", async () => {
    mockTx({});
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredReferenceScriptHash: REF_SH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "provider_data_missing:referenceInputs" });
  });

  it("output_datum_hash_mismatch", async () => {
    mockTx({ outputDatums: [{ outputIndex: 0, datumHash: "ff".repeat(32), inlineDatumCborHex: null }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredOutputDatumHash: DH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "rejected", reason: "output_datum_hash_mismatch" });
  });

  it("verified when output datum hash matches", async () => {
    mockTx({ outputDatums: [{ outputIndex: 0, datumHash: DH, inlineDatumCborHex: null }] });
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredOutputDatumHash: DH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "verified" });
  });

  it("needs_review provider_data_missing:outputDatums when undefined", async () => {
    mockTx({});
    const r = await verifyTxHash({
      taskType: "tx_swap",
      taskConfig: { scriptAddresses: [SCRIPT], requiredOutputDatumHash: DH },
      task: {},
      user: { stakeAddress: STAKE },
      submission: { txHash: TX },
    });
    expect(r).toEqual({ status: "needs_review", reason: "provider_data_missing:outputDatums" });
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
