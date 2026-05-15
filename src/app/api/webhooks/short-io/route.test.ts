import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for the Short.io webhook. We mock the DB layer at the
 * `getDb()` boundary so we can assert insert calls without standing up a
 * real D1 instance.
 */

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface DbState {
  trackedLinkRow: { id: string; dubLinkId: string; userRefCode: string | null } | null;
  userStakeForRefCode: string | null;
  insertCalls: Array<Record<string, unknown>>;
  insertThrows: Error | null;
  _selectCount: number;
}

let dbState: DbState;

function makeDbStub() {
  // Mimic the drizzle chainable surface used by the route. Each chain
  // ends in a thenable / array-like returning a Promise.
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
      // Cheap discriminator: first select() call in the handler is for
      // trackedLinks, second is for users.
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

// Mutable env so individual tests can simulate the "secret missing" case
// without resetting modules (which would undo our DB mock).
const mockEnv: { SHORTIO_WEBHOOK_SECRET?: string } = { SHORTIO_WEBHOOK_SECRET: "shh" };

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: mockEnv }),
}));

// Drizzle's `eq` and the schema imports go through unchanged — the stub
// above ignores the `where(...)` argument entirely.

let POST: (req: Request) => Promise<Response>;

beforeEach(async () => {
  dbState = {
    trackedLinkRow: null,
    userStakeForRefCode: null,
    insertCalls: [],
    insertThrows: null,
    _selectCount: 0,
  };
  mockEnv.SHORTIO_WEBHOOK_SECRET = "shh";
  const mod = await import("./route");
  POST = mod.POST;
});

afterEach(() => {
  // Intentionally do NOT resetModules — we'd lose the top-level mocks.
});

function makeReq(body: string, sig: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (sig) headers.set("x-short-signature", sig);
  return new Request("https://leaderboard.learncardano.io/api/webhooks/short-io", {
    method: "POST",
    headers,
    body,
  });
}

describe("short-io webhook route", () => {
  it("503 when secret missing", async () => {
    delete mockEnv.SHORTIO_WEBHOOK_SECRET;
    const res = await POST(makeReq("{}", "deadbeef"));
    expect(res.status).toBe(503);
  });

  it("401 when signature missing", async () => {
    const res = await POST(makeReq("{}", null));
    expect(res.status).toBe(401);
  });

  it("401 on bad signature", async () => {
    const res = await POST(makeReq('{"link":{"id":"L1"}}', "deadbeef"));
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
    const sig = await hmacHex("shh", body);
    const res = await POST(makeReq(body, sig));
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
    const sig = await hmacHex("shh", body);
    const res = await POST(makeReq(body, sig));
    expect(res.status).toBe(200);
    expect(dbState.insertCalls).toHaveLength(0);
    const json = (await res.json()) as { dropped?: string };
    expect(json.dropped).toBe("unknown_link");
  });

  it("200 even when insert throws (idempotency / duplicate event)", async () => {
    dbState.trackedLinkRow = { id: "tl-1", dubLinkId: "L1", userRefCode: null };
    dbState.insertThrows = new Error("UNIQUE constraint failed");
    const body = JSON.stringify({ link: { id: "L1" }, eventId: "evt-dup" });
    const sig = await hmacHex("shh", body);
    const res = await POST(makeReq(body, sig));
    expect(res.status).toBe(200);
  });

  it("200 + drops unrecognised payload shape", async () => {
    const body = JSON.stringify({ totally: "wrong" });
    const sig = await hmacHex("shh", body);
    const res = await POST(makeReq(body, sig));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { dropped?: string };
    expect(json.dropped).toBe("unrecognised_shape");
  });
});
