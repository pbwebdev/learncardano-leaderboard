import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxInfo } from "@/lib/cardano/types";

// ----------- mock state -----------
let pendingBatches: Array<{
  id: string;
  txHash: string | null;
  csvR2Key: string;
  paidAt: Date | null;
  verifiedOnChain: boolean;
}> = [];
const updatedBatches: Array<{ id: string; set: Record<string, unknown> }> = [];
const updatedSubmissions: Array<{ where: string; set: Record<string, unknown> }> = [];
const auditInserts: Array<Record<string, unknown>> = [];

let r2GetReturn: { text: () => Promise<string> } | null = null;
let txInfoReturn: TxInfo | null = null;

// ----------- mocks (must precede imports) -----------
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { R2: { get: async () => r2GetReturn } },
  }),
}));

vi.mock("@/lib/cardano", () => ({
  getTxInfo: async () => txInfoReturn,
  // Other helpers used by the rest of cron-handler — not exercised here.
  getAccountInfo: async () => null,
  getDRepInfo: async () => null,
}));

vi.mock("@/lib/points", () => ({
  refreshLeaderboardCache: async () => {},
}));

// drizzle/d1 stub: a chainable mock that records writes and serves reads
// from the test state. We don't import @/db/client here — cron-handler
// builds its own drizzle() instance from `env.DB`.
vi.mock("drizzle-orm/d1", () => {
  const makeDb = () => {
    let currentTable: string | null = null;
    let pendingInsertTable: string | null = null;
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.from = (tbl: { __tag?: string }) => {
      currentTable = tbl.__tag ?? null;
      return api;
    };
    api.where = () => api;
    api.limit = async () => readAll();
    // For non-limited reads we return an array on `await api`. We can fake
    // that by making `api` thenable, but the simpler path is to expose the
    // read via `.then` once `where()` is the terminus. cron-handler uses
    // `.where(...)` without `.limit()` for the pending fetch, so:
    api.then = (resolve: (v: unknown) => unknown) => resolve(readAll());
    api.update = (tbl: { __tag?: string }) => {
      const tag = tbl.__tag ?? "?";
      return {
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            if (tag === "partnerPayoutBatches") updatedBatches.push({ id: lastWhereId, set });
            else if (tag === "submissions") updatedSubmissions.push({ where: lastWhereId, set });
          },
        }),
      };
    };
    api.insert = (tbl: { __tag?: string }) => {
      pendingInsertTable = tbl.__tag ?? "?";
      return {
        values: async (row: Record<string, unknown>) => {
          if (pendingInsertTable === "auditLog") auditInserts.push(row);
        },
      };
    };
    function readAll() {
      if (currentTable === "partnerPayoutBatches") return pendingBatches;
      return [];
    }
    return api;
  };
  return { drizzle: () => makeDb() };
});

// Schema tagging so the stub above can identify tables.
vi.mock("@/db/schema", () => ({
  partnerPayoutBatches: {
    __tag: "partnerPayoutBatches",
    id: "id",
    txHash: "txHash",
    verifiedOnChain: "verifiedOnChain",
  },
  submissions: { __tag: "submissions", payoutBatchId: "payoutBatchId", status: "status" },
  pointsLedger: { __tag: "pointsLedger" },
  tasks: { __tag: "tasks", status: "status", taskType: "taskType" },
  auditLog: { __tag: "auditLog" },
}));

// drizzle-orm operators — opaque sentinels that capture batch ids for the
// `where(eq(...))` calls so the mock can identify which batch is being
// updated. cron-handler only ever updates by id, so we record the id.
let lastWhereId = "";
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => {
    if (typeof val === "string") lastWhereId = val;
    return { col, val };
  },
  inArray: () => ({}),
  isNotNull: () => ({}),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// Import after mocks.
import { handleScheduled } from "./cron-handler";

beforeEach(() => {
  pendingBatches = [];
  updatedBatches.length = 0;
  updatedSubmissions.length = 0;
  auditInserts.length = 0;
  r2GetReturn = null;
  txInfoReturn = null;
});

function makeTx(outputs: Array<{ address: string; lovelace: number }>, blockTimeSeconds: number): TxInfo {
  return {
    hash: "deadbeef".repeat(8),
    block_hash: null,
    block_height: null,
    block_time: blockTimeSeconds,
    num_confirmations: 10,
    inputs: [],
    outputs: outputs.map((o) => ({ address: o.address, amount: [{ unit: "lovelace", quantity: String(o.lovelace) }] })),
    stake_addresses: [],
  };
}

const PAID_AT_MS = 1700000000000;
const PAID_AT_S = PAID_AT_MS / 1000;
const CSV = `payment_address,stake_address,total_reward,asset,submission_ids,completed_at
addr1qxabc,stake1xabc,50000000,ADA,sub-1,2026-05-15T00:00:00.000Z
`;

describe("daily cron — payout batch on-chain verification", () => {
  it("happy path: verified_on_chain=true + submissions move to reward_verified", async () => {
    pendingBatches = [
      {
        id: "batch-1",
        txHash: "a".repeat(64),
        csvR2Key: "payouts/batch-1/winners.csv",
        paidAt: new Date(PAID_AT_MS),
        verifiedOnChain: false,
      },
    ];
    r2GetReturn = { text: async () => CSV };
    txInfoReturn = makeTx([{ address: "addr1qxabc", lovelace: 50_000_000 }], PAID_AT_S);

    await handleScheduled("15 3 * * *", { DB: {} as never });

    const batchUpdate = updatedBatches.find((u) => u.set.verifiedOnChain === true);
    expect(batchUpdate).toBeTruthy();
    expect(batchUpdate?.id).toBe("batch-1");

    const subUpdate = updatedSubmissions.find((u) => u.set.status === "reward_verified");
    expect(subUpdate).toBeTruthy();

    expect(auditInserts.some((a) => a.field === "verified_on_chain" && a.newValue === "true")).toBe(true);
  });

  it("amount mismatch: records discrepancy, does NOT flip verifiedOnChain", async () => {
    pendingBatches = [
      {
        id: "batch-2",
        txHash: "b".repeat(64),
        csvR2Key: "payouts/batch-2/winners.csv",
        paidAt: new Date(PAID_AT_MS),
        verifiedOnChain: false,
      },
    ];
    r2GetReturn = { text: async () => CSV };
    // Underpaid by 1 ADA.
    txInfoReturn = makeTx([{ address: "addr1qxabc", lovelace: 49_000_000 }], PAID_AT_S);

    await handleScheduled("15 3 * * *", { DB: {} as never });

    expect(updatedBatches.some((u) => u.set.verifiedOnChain === true)).toBe(false);
    const discrepancyWrite = updatedBatches.find((u) => typeof u.set.discrepancyNote === "string");
    expect(discrepancyWrite).toBeTruthy();
    expect(String(discrepancyWrite?.set.discrepancyNote)).toMatch(/amount_mismatch/);
  });

  it("tx outside ±24h window of paidAt: discrepancy", async () => {
    pendingBatches = [
      {
        id: "batch-3",
        txHash: "c".repeat(64),
        csvR2Key: "payouts/batch-3/winners.csv",
        paidAt: new Date(PAID_AT_MS),
        verifiedOnChain: false,
      },
    ];
    r2GetReturn = { text: async () => CSV };
    // 48h before paidAt → outside the window.
    txInfoReturn = makeTx([{ address: "addr1qxabc", lovelace: 50_000_000 }], PAID_AT_S - 48 * 3600);

    await handleScheduled("15 3 * * *", { DB: {} as never });

    expect(updatedBatches.some((u) => u.set.verifiedOnChain === true)).toBe(false);
    const note = updatedBatches.find((u) => typeof u.set.discrepancyNote === "string");
    expect(String(note?.set.discrepancyNote)).toMatch(/outside .24h window/);
  });

  it("missing CSV in R2: discrepancy", async () => {
    pendingBatches = [
      {
        id: "batch-4",
        txHash: "d".repeat(64),
        csvR2Key: "payouts/batch-4/winners.csv",
        paidAt: new Date(PAID_AT_MS),
        verifiedOnChain: false,
      },
    ];
    r2GetReturn = null;
    txInfoReturn = makeTx([{ address: "addr1qxabc", lovelace: 50_000_000 }], PAID_AT_S);

    await handleScheduled("15 3 * * *", { DB: {} as never });

    const note = updatedBatches.find((u) => typeof u.set.discrepancyNote === "string");
    expect(String(note?.set.discrepancyNote)).toMatch(/csv missing from R2/);
  });

  it("tx not found yet: leaves batch alone", async () => {
    pendingBatches = [
      {
        id: "batch-5",
        txHash: "e".repeat(64),
        csvR2Key: "payouts/batch-5/winners.csv",
        paidAt: new Date(PAID_AT_MS),
        verifiedOnChain: false,
      },
    ];
    r2GetReturn = { text: async () => CSV };
    txInfoReturn = null;

    await handleScheduled("15 3 * * *", { DB: {} as never });
    expect(updatedBatches).toHaveLength(0);
  });
});
