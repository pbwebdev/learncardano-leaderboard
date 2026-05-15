import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBountyHmac } from "@/lib/verification/bounty";

const SECRET = "test-bounty-secret";

// ---------- mock state used by mocks below ----------
let stubTasks: Array<{
  id: string;
  taskType: string;
  taskConfig: unknown;
  status: string;
  points: number;
}> = [];
let stubUsers: Array<{ stakeAddress: string }> = [];
let stubSubmissions: Array<{ id: string; userId: string; taskId: string; status: string }> = [];
const insertedSubmissions: Array<Record<string, unknown>> = [];
const insertedLedger: Array<Record<string, unknown>> = [];
const auditCalls: Array<Record<string, unknown>> = [];

// ---------- mocks (must precede route import) ----------
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { BOUNTY_WEBHOOK_HMAC_SECRET: SECRET } }),
}));

vi.mock("@/lib/audit", () => ({
  logChange: (opts: Record<string, unknown>) => {
    auditCalls.push(opts);
    return Promise.resolve();
  },
}));

// Lightweight Drizzle-like chainable stub. The route uses:
//   db.select(...).from(tasks).where(...).limit(2)
//   db.select(...).from(users).where(...).limit(1)
//   db.select(...).from(submissions).where(...).limit(1)
//   db.insert(submissions).values({...})
//   db.insert(pointsLedger).values({...})
vi.mock("@/db/client", () => {
  const makeDb = () => {
    let currentTable: string | null = null;
    let pendingInsert: string | null = null;
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.from = (tbl: { _: { name: string } } | string) => {
      // Drizzle table object's name lives at sqliteTable's symbol export; in tests we
      // identify by reference equality against the imported schema objects.
      currentTable = (tbl as { __tag?: string }).__tag ?? String(tbl);
      return api;
    };
    api.where = () => api;
    api.limit = async () => {
      switch (currentTable) {
        case "tasks":
          return stubTasks;
        case "users":
          return stubUsers;
        case "submissions":
          return stubSubmissions;
        default:
          return [];
      }
    };
    api.insert = (tbl: { __tag?: string }) => {
      pendingInsert = tbl.__tag ?? "unknown";
      return {
        values: async (row: Record<string, unknown>) => {
          if (pendingInsert === "submissions") insertedSubmissions.push(row);
          else if (pendingInsert === "pointsLedger") insertedLedger.push(row);
        },
      };
    };
    return api;
  };
  return { getDb: () => makeDb() };
});

// Tag the schema table objects so the stub above can identify them.
vi.mock("@/db/schema", () => ({
  tasks: { __tag: "tasks", taskType: "taskType", taskConfig: "taskConfig" },
  users: { __tag: "users", stakeAddress: "stakeAddress" },
  submissions: { __tag: "submissions", id: "id", userId: "userId", taskId: "taskId", status: "status" },
  pointsLedger: { __tag: "pointsLedger" },
}));

// drizzle-orm operators — return whatever; the where clause is ignored by the stub.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// Import after mocks.
import { POST } from "./route";

beforeEach(() => {
  stubTasks = [];
  stubUsers = [];
  stubSubmissions = [];
  insertedSubmissions.length = 0;
  insertedLedger.length = 0;
  auditCalls.length = 0;
});

async function makeRequest(body: Record<string, unknown>): Promise<Request> {
  return new Request("https://example.com/api/webhooks/bounty", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function signedBody(stake: string, bounty: string, ts: number) {
  const sig = await computeBountyHmac(SECRET, stake, bounty, ts);
  return { stake_address: stake, bounty_id: bounty, completed_at: ts, hmac_signature: sig };
}

describe("/api/webhooks/bounty", () => {
  it("returns 401 on bad HMAC", async () => {
    const req = await makeRequest({
      stake_address: "stake1abc",
      bounty_id: "b1",
      completed_at: 1700000000,
      hmac_signature: "deadbeef",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 + drops on malformed JSON", async () => {
    const req = new Request("https://example.com/api/webhooks/bounty", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.dropped).toBe("malformed_json");
  });

  it("returns 200 + drops when no task matches the bounty_id", async () => {
    const body = await signedBody("stake1abc", "b1", 1700000000);
    const res = await POST(await makeRequest(body));
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.dropped).toBe("no_task_for_bounty");
  });

  it("returns 200 + drops when task is not active", async () => {
    stubTasks = [{ id: "t1", taskType: "bounty_completion", taskConfig: { bountyId: "b1" }, status: "paused", points: 50 }];
    const body = await signedBody("stake1abc", "b1", 1700000000);
    const res = await POST(await makeRequest(body));
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.dropped).toBe("task_not_active");
  });

  it("drops with user_not_found when stake address has no users row", async () => {
    stubTasks = [{ id: "t1", taskType: "bounty_completion", taskConfig: { bountyId: "b1" }, status: "active", points: 50 }];
    stubUsers = [];
    const body = await signedBody("stake1abc", "b1", 1700000000);
    const res = await POST(await makeRequest(body));
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.dropped).toBe("user_not_found");
  });

  it("inserts a verified submission + points + audit on the happy path", async () => {
    stubTasks = [{ id: "t1", taskType: "bounty_completion", taskConfig: { bountyId: "b1" }, status: "active", points: 50 }];
    stubUsers = [{ stakeAddress: "stake1abc" }];
    stubSubmissions = [];
    const body = await signedBody("stake1abc", "b1", 1700000000);
    const res = await POST(await makeRequest(body));
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.ok).toBe(true);
    expect(j.submissionId).toBeTruthy();

    expect(insertedSubmissions).toHaveLength(1);
    expect(insertedSubmissions[0].status).toBe("verified");
    expect(insertedSubmissions[0].taskId).toBe("t1");
    expect(insertedSubmissions[0].userId).toBe("stake1abc");

    expect(insertedLedger).toHaveLength(1);
    expect(insertedLedger[0].delta).toBe(50);
    expect(insertedLedger[0].reason).toBe("task_verified");

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].entityType).toBe("submission");
  });

  it("is idempotent — a second delivery returns already_recorded and does not double-insert", async () => {
    stubTasks = [{ id: "t1", taskType: "bounty_completion", taskConfig: { bountyId: "b1" }, status: "active", points: 50 }];
    stubUsers = [{ stakeAddress: "stake1abc" }];
    stubSubmissions = [{ id: "existing-id", userId: "stake1abc", taskId: "t1", status: "verified" }];
    const body = await signedBody("stake1abc", "b1", 1700000000);
    const res = await POST(await makeRequest(body));
    expect(res.status).toBe(200);
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.already_recorded).toBe(true);
    expect(j.submissionId).toBe("existing-id");
    expect(insertedSubmissions).toHaveLength(0);
    expect(insertedLedger).toHaveLength(0);
  });

  it("skips the ledger insert when points === 0", async () => {
    stubTasks = [{ id: "t1", taskType: "bounty_completion", taskConfig: { bountyId: "b1" }, status: "active", points: 0 }];
    stubUsers = [{ stakeAddress: "stake1abc" }];
    const body = await signedBody("stake1abc", "b1", 1700000000);
    await POST(await makeRequest(body));
    expect(insertedSubmissions).toHaveLength(1);
    expect(insertedLedger).toHaveLength(0);
  });
});
