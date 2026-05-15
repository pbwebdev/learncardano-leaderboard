import { describe, expect, it } from "vitest";
import {
  ADA_ASSET,
  LOVELACE_PER_ADA,
  compareCsvToTxOutputs,
  csvHeader,
  csvRow,
  formatCsv,
  groupForExport,
  isValidTxHash,
  isWithinPaidAtWindow,
  parseCsv,
  type PayoutRow,
} from "./payouts";
import type { TxInfo } from "./cardano/types";

const ROW_A: PayoutRow = {
  paymentAddress: "addr1qxabc",
  stakeAddress: "stake1xabc",
  totalReward: 50_000_000,
  asset: ADA_ASSET,
  submissionIds: ["sub-1", "sub-2"],
  completedAt: "2026-05-15T00:00:00.000Z",
};

describe("csvHeader/csvRow/formatCsv/parseCsv", () => {
  it("round-trips a single row", () => {
    const csv = formatCsv([ROW_A]);
    expect(csv.split("\n")[0]).toBe(csvHeader());
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([ROW_A]);
  });

  it("round-trips multiple rows + tokens", () => {
    const rowB: PayoutRow = {
      paymentAddress: "addr1q9def",
      stakeAddress: "stake1xdef",
      totalReward: 1000,
      asset: "abcd1234.74657374746f6b",
      submissionIds: ["sub-3"],
      completedAt: "2026-05-14T01:02:03.000Z",
    };
    const csv = formatCsv([ROW_A, rowB]);
    expect(parseCsv(csv)).toEqual([ROW_A, rowB]);
  });

  it("renders csvRow exactly per the spec", () => {
    expect(csvRow(ROW_A)).toBe(
      "addr1qxabc,stake1xabc,50000000,ADA,sub-1|sub-2,2026-05-15T00:00:00.000Z",
    );
  });

  it("parseCsv throws on missing column", () => {
    expect(() => parseCsv("foo,bar\n1,2\n")).toThrow(/csv_missing_column/);
  });

  it("parseCsv tolerates CRLF line endings", () => {
    const csv = formatCsv([ROW_A]).replace(/\n/g, "\r\n");
    expect(parseCsv(csv)).toEqual([ROW_A]);
  });

  it("parseCsv handles an empty submission_ids field", () => {
    const csv = csvHeader() + "\naddr,stake,1,ADA,,2026-01-01T00:00:00.000Z\n";
    const [row] = parseCsv(csv);
    expect(row.submissionIds).toEqual([]);
  });
});

describe("groupForExport", () => {
  it("sums lovelace across multiple submissions for one user", () => {
    const rows = groupForExport([
      { submissionId: "s1", userId: "stake1u1", paymentAddress: "addr1u1", taskPoints: 10, tokenReward: null, verifiedAt: 1700000000000 },
      { submissionId: "s2", userId: "stake1u1", paymentAddress: "addr1u1", taskPoints: 20, tokenReward: null, verifiedAt: 1700000600000 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalReward).toBe(30 * LOVELACE_PER_ADA);
    expect(rows[0].asset).toBe(ADA_ASSET);
    expect(rows[0].submissionIds.sort()).toEqual(["s1", "s2"]);
    // Latest verifiedAt wins for completed_at.
    expect(rows[0].completedAt).toBe(new Date(1700000600000).toISOString());
  });

  it("splits a user with both ADA + token rewards into two rows", () => {
    const rows = groupForExport([
      { submissionId: "s1", userId: "stake1u1", paymentAddress: "addr1u1", taskPoints: 10, tokenReward: null, verifiedAt: 1700000000000 },
      { submissionId: "s2", userId: "stake1u1", paymentAddress: "addr1u1", taskPoints: 0, tokenReward: { policyId: "abcd", assetName: "deadbeef", quantity: 5 }, verifiedAt: 1700000600000 },
    ]);
    expect(rows).toHaveLength(2);
    const ada = rows.find((r) => r.asset === ADA_ASSET);
    const tok = rows.find((r) => r.asset === "abcd.deadbeef");
    expect(ada?.totalReward).toBe(10 * LOVELACE_PER_ADA);
    expect(tok?.totalReward).toBe(5);
  });

  it("groups two users separately", () => {
    const rows = groupForExport([
      { submissionId: "s1", userId: "stake1u1", paymentAddress: "addr1u1", taskPoints: 10, tokenReward: null, verifiedAt: 1700000000000 },
      { submissionId: "s2", userId: "stake1u2", paymentAddress: "addr1u2", taskPoints: 20, tokenReward: null, verifiedAt: 1700000000000 },
    ]);
    expect(rows).toHaveLength(2);
  });
});

function makeTx(outputs: Array<{ address: string; lovelace?: number; tokens?: Array<{ unit: string; quantity: number }> }>, blockTimeSeconds = 1700000000): TxInfo {
  return {
    hash: "deadbeef".repeat(8),
    block_hash: "block",
    block_height: 1,
    block_time: blockTimeSeconds,
    num_confirmations: 10,
    inputs: [],
    outputs: outputs.map((o) => ({
      address: o.address,
      amount: [
        ...(o.lovelace != null ? [{ unit: "lovelace", quantity: String(o.lovelace) }] : []),
        ...(o.tokens ?? []).map((t) => ({ unit: t.unit, quantity: String(t.quantity) })),
      ],
    })),
    stake_addresses: [],
  };
}

describe("compareCsvToTxOutputs", () => {
  it("returns ok when every row has a matching ADA output", () => {
    const tx = makeTx([{ address: "addr1qxabc", lovelace: 50_000_000 }]);
    expect(compareCsvToTxOutputs([ROW_A], tx)).toEqual({ ok: true });
  });

  it("flags a no_output_to_recipient discrepancy", () => {
    const tx = makeTx([{ address: "addr1qxOTHER", lovelace: 50_000_000 }]);
    const r = compareCsvToTxOutputs([ROW_A], tx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.discrepancies[0].reason).toBe("no_output_to_recipient");
      expect(r.discrepancies[0].expected).toBe(50_000_000);
      expect(r.discrepancies[0].actual).toBe(0);
    }
  });

  it("flags an amount_mismatch when the lovelace differs", () => {
    const tx = makeTx([{ address: "addr1qxabc", lovelace: 49_000_000 }]);
    const r = compareCsvToTxOutputs([ROW_A], tx);
    if (!r.ok) {
      expect(r.discrepancies[0].reason).toBe("amount_mismatch");
      expect(r.discrepancies[0].actual).toBe(49_000_000);
    } else {
      throw new Error("expected discrepancy");
    }
  });

  it("matches token assets in either dot or concat form", () => {
    const row: PayoutRow = { ...ROW_A, totalReward: 5, asset: "abcd.deadbeef" };
    const txDot = makeTx([{ address: row.paymentAddress, tokens: [{ unit: "abcd.deadbeef", quantity: 5 }] }]);
    const txConcat = makeTx([{ address: row.paymentAddress, tokens: [{ unit: "abcddeadbeef", quantity: 5 }] }]);
    expect(compareCsvToTxOutputs([row], txDot)).toEqual({ ok: true });
    expect(compareCsvToTxOutputs([row], txConcat)).toEqual({ ok: true });
  });

  it("sums lovelace across multiple outputs to the same recipient", () => {
    const tx = makeTx([
      { address: "addr1qxabc", lovelace: 30_000_000 },
      { address: "addr1qxabc", lovelace: 20_000_000 },
    ]);
    expect(compareCsvToTxOutputs([ROW_A], tx)).toEqual({ ok: true });
  });

  it("flags missing_asset_in_bundle when the recipient got an output but no matching unit", () => {
    const row: PayoutRow = { ...ROW_A, totalReward: 5, asset: "abcd.deadbeef" };
    const tx = makeTx([{ address: row.paymentAddress, lovelace: 1_000_000 }]);
    const r = compareCsvToTxOutputs([row], tx);
    if (!r.ok) {
      expect(r.discrepancies[0].reason).toBe("missing_asset_in_bundle");
    } else {
      throw new Error("expected discrepancy");
    }
  });
});

describe("isWithinPaidAtWindow", () => {
  it("accepts ±24h windows by default", () => {
    const paid = 1700000000000;
    expect(isWithinPaidAtWindow(1700000000, paid)).toBe(true);
    expect(isWithinPaidAtWindow(1700000000 + 23 * 3600, paid)).toBe(true);
    expect(isWithinPaidAtWindow(1700000000 + 25 * 3600, paid)).toBe(false);
    expect(isWithinPaidAtWindow(null, paid)).toBe(false);
  });
});

describe("isValidTxHash", () => {
  it("accepts 64-char lowercase hex", () => {
    expect(isValidTxHash("a".repeat(64))).toBe(true);
    expect(isValidTxHash(" " + "F".repeat(64) + " ")).toBe(true); // trimmed + lowercased
  });
  it("rejects everything else", () => {
    expect(isValidTxHash("")).toBe(false);
    expect(isValidTxHash("a".repeat(63))).toBe(false);
    expect(isValidTxHash("g".repeat(64))).toBe(false);
  });
});
