import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for the Short.io webhook (URL-as-secret auth).
 * Mock the DB at the getDb() boundary; assert insert calls without
 * standing up a real D1.
 */

interface DbState {
  trackedLinkRow: { id: string; dubLinkId: string; userRefCode: string | null } | null;
  userStakeForRefCode: string | null;
  insertCalls: Array<Record<string, unknown>>;
  insertThrows: Error | null;
  _selectCount: number;
}

let dbState: DbState;

function makeDbStub() {
  const trackedLinksSelect = {
    from: () => ({
      where: () => ({
        limit: async () => (dbState.trackedLinkRow ? [dbState.trackedLinkRow] : []),
      }),
    }),
  };
  const usersSelect = {
    from: () => ({
      where: () => ({
        limit: async () => (dbState.userStakeForRefCode ? [{ stakeAddress: dbState.userStakeForRefCode }] : []),
      }),
    }),
  };
  return {
    select: (_cols?: unknown) => {
      const which = dbState._selectCount++;
      return which === 0 ? trackedLinksSelect : usersSelect;
    },
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (dbState.insertThrows) throw dbState.insertThrows;
        dbState.insertCalls.push(row);
      },
    }),
    _selectCount: 0,
  };
}

vi.mock("@/db/client", () => ({
  getDb: () => {
    dbState._selectCount = 0;
    return makeDbStub();
  },
}));

const mockEnv: { SHORTIO_WEBHOOK_TOKEN?: string } = { SHORTIO_WEBHOOK_TOKEN: "expected-token" };

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: mockEnv }),
}));

let POST: (
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) => Promise<Response>;

beforeEach(async () => {
  dbState = {
    trackedLinkRow: null,
    userStakeForRefCode: null,
    insertCalls: [],
    insertThrows: null,
    _selectCount: 0,
  };
  mockEnv.SHORTIO_WEBHOOK_TOKEN = "expected-token";
  const mod = await import("./route");
  POST = mod.POST;
});

function makeReq(body: string): Request {
  return new Request("https://leaderboard.learncardano.io/api/webhooks/short-io/anything", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe("short-io webhook route (URL-as-secret)", () => {
  it("503 when SHORTIO_WEBHOOK_TOKEN env unset", async () => {
    delete mockEnv.SHORTIO_WEBHOOK_TOKEN;
    const res = await POST(makeReq("{}"), makeParams("expected-token"));
    expect(res.status).toBe(503);
  });

  it("401 when path token mismatches the env token", async () => {
    const res = await POST(makeReq("{}"), makeParams("wrong-token"));
    expect(res.status).toBe(401);
  });

  it("401 when path token is empty", async () => {
    const res = await POST(makeReq("{}"), makeParams(""));
    expect(res.status).toBe(401);
  });

  it("401 even when only the length matches (constant-time guard)", async () => {
    // Same length as "expected-token" (14 chars) but different bytes.
    const res = await POST(makeReq("{}"), makeParams("xxxxxxxxxxxxxx"));
    expect(res.status).toBe(401);
  });

  it("inserts a click row on happy path and resolves user from refCode", async () => {
    dbState.trackedLinkRow = { id: "tl-1", dubLinkId: "L1", userRefCode: "REF1" };
    dbState.userStakeForRefCode = "stake1xxx";
    const body = JSON.stringify({
      link: { id: "L1" },
      eventId: "evt-1",
      country: "AU",
      referer: "https://t.co",
      userAgent: "ua/1",
      clickedAt: "2026-01-01T00:00:00Z",
    });
    const res = await POST(makeReq(body), makeParams("expected-token"));
    expect(res.status).toBe(200);
    expect(dbState.insertCalls).toHaveLength(1);
    const row = dbState.insertCalls[0];
    expect(row).toMatchObject({
      trackedLinkId: "tl-1",
      dubEventId: "evt-1",
      userId: "stake1xxx",
      country: "AU",
      referrer: "https://t.co",
      userAgent: "ua/1",
    });
    expect(row.ts).toBeInstanceOf(Date);
  });

  it("200 + drops unknown link", async () => {
    dbState.trackedLinkRow = null;
    const body = JSON.stringify({ link: { id: "L_missing" } });
    const res = await POST(makeReq(body), makeParams("expected-token"));
    expect(res.status).toBe(200);
    expect(dbState.insertCalls).toHaveLength(0);
    const json = (await res.json()) as { dropped?: string };
    expect(json.dropped).toBe("unknown_link");
  });

  it("200 even when insert throws (idempotency / duplicate event)", async () => {
    dbState.trackedLinkRow = { id: "tl-1", dubLinkId: "L1", userRefCode: null };
    dbState.insertThrows = new Error("UNIQUE constraint failed");
    const body = JSON.stringify({ link: { id: "L1" }, eventId: "evt-dup" });
    const res = await POST(makeReq(body), makeParams("expected-token"));
    expect(res.status).toBe(200);
  });

  it("200 + drops unrecognised payload shape", async () => {
    const body = JSON.stringify({ totally: "wrong" });
    const res = await POST(makeReq(body), makeParams("expected-token"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dropped?: string };
    expect(json.dropped).toBe("unrecognised_shape");
  });

  it("200 + drops malformed JSON after valid token", async () => {
    const res = await POST(makeReq("{not json"), makeParams("expected-token"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dropped?: string };
    expect(json.dropped).toBe("malformed_json");
  });
});
