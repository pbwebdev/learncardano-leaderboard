import { describe, expect, it, vi, beforeEach } from "vitest";

const kvStore = new Map<string, string>();
const kvGet = vi.fn(async (k: string, _type: "json") => {
  const v = kvStore.get(k);
  return v ? JSON.parse(v) : null;
});
const kvPut = vi.fn(async (k: string, v: string) => {
  kvStore.set(k, v);
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { KV: { get: kvGet, put: kvPut } } }),
}));

// Stub the db client so module load doesn't try to read a real binding.
// Tests that need richer behaviour push result arrays onto `dbResultsQueue`
// before invoking the function under test; each terminal `.limit()` /
// awaited `.where()` pops the next array. Otherwise returns [] (the default
// used by the cache-layer tests above).
const dbResultsQueue: unknown[][] = [];
function nextDbResult(): unknown[] {
  return dbResultsQueue.shift() ?? [];
}
// Make the chain await-able at every reasonable terminal — getPointsLeaderboard
// uses .orderBy().limit(); getRankFor uses .where().limit() AND a bare
// .where() that's awaited directly.
function makeChain(): unknown {
  // A Proxy that returns itself for any method call AND resolves to the next
  // result array when awaited (via its `.then`).
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(nextDbResult());
      }
      return () => makeChain();
    },
  };
  return new Proxy({}, handler);
}
vi.mock("@/db/client", () => ({
  getDb: () => makeChain(),
}));

import {
  getCachedLeaderboard,
  getRankFor,
  rankLeaderboardRows,
  refreshLeaderboardCache,
  sumDeltas,
  validateDelta,
  type LeaderboardInput,
} from "./points";

/**
 * Tests for the points ledger pure-logic helpers. The DB wrappers in
 * points.ts call these helpers; the DB itself is exercised end-to-end in
 * dev / preview deploys, not in unit tests (sibling project pattern —
 * unit tests are pure-logic only).
 */

describe("points: validateDelta", () => {
  it("returns the delta unchanged for a positive integer", () => {
    expect(validateDelta(50)).toBe(50);
  });

  it("returns the delta unchanged for a negative integer (clawback)", () => {
    expect(validateDelta(-30)).toBe(-30);
  });

  it("returns null for zero (no-op)", () => {
    expect(validateDelta(0)).toBeNull();
  });

  it("throws on non-integer values", () => {
    expect(() => validateDelta(1.5)).toThrow("points_delta_must_be_integer");
  });

  it("throws on NaN / Infinity", () => {
    expect(() => validateDelta(Number.NaN)).toThrow("points_delta_must_be_integer");
    expect(() => validateDelta(Number.POSITIVE_INFINITY)).toThrow("points_delta_must_be_integer");
  });
});

describe("points: sumDeltas (clawback math)", () => {
  it("returns 0 for empty input", () => {
    expect(sumDeltas([])).toBe(0);
  });

  it("sums positive deltas", () => {
    expect(sumDeltas([{ delta: 50 }, { delta: 30 }, { delta: 20 }])).toBe(100);
  });

  it("subtracts negative deltas (clawbacks)", () => {
    expect(sumDeltas([{ delta: 100 }, { delta: -30 }, { delta: 50 }])).toBe(120);
  });

  it("returns net zero when delta and clawback cancel", () => {
    expect(sumDeltas([{ delta: 50 }, { delta: -50 }])).toBe(0);
  });
});

const baseInput = (): LeaderboardInput => ({
  users: [],
  ledger: [],
  submissions: [],
  tasks: [],
});

describe("points: rankLeaderboardRows ordering", () => {
  it("orders users by total points descending and assigns 1-based rank", () => {
    const input = baseInput();
    input.users = [
      { stakeAddress: "stake1a", profileVisibility: "public" },
      { stakeAddress: "stake1b", profileVisibility: "public" },
      { stakeAddress: "stake1c", profileVisibility: "public" },
    ];
    input.ledger = [
      { userId: "stake1a", delta: 50 },
      { userId: "stake1b", delta: 200 },
      { userId: "stake1c", delta: 100 },
    ];
    const board = rankLeaderboardRows(input, 10);
    expect(board.map((r) => [r.rank, r.stakeAddress, r.totalPoints])).toEqual([
      [1, "stake1b", 200],
      [2, "stake1c", 100],
      [3, "stake1a", 50],
    ]);
  });

  it("limits to top N", () => {
    const input = baseInput();
    input.users = Array.from({ length: 5 }, (_, i) => ({
      stakeAddress: `stake1u${i}`,
      profileVisibility: "public",
    }));
    input.ledger = input.users.map((u, i) => ({ userId: u.stakeAddress, delta: (i + 1) * 10 }));
    const board = rankLeaderboardRows(input, 3);
    expect(board).toHaveLength(3);
    expect(board[0].stakeAddress).toBe("stake1u4");
  });
});

describe("points: rankLeaderboardRows excludes private users", () => {
  it("filters out profileVisibility='private' rows", () => {
    const input = baseInput();
    input.users = [
      { stakeAddress: "stake1a", profileVisibility: "public" },
      { stakeAddress: "stake1b", profileVisibility: "private" },
    ];
    input.ledger = [
      { userId: "stake1a", delta: 50 },
      { userId: "stake1b", delta: 1000 },
    ];
    const board = rankLeaderboardRows(input, 10);
    expect(board).toHaveLength(1);
    expect(board[0].stakeAddress).toBe("stake1a");
  });
});

describe("points: rankLeaderboardRows drops zero-activity users", () => {
  it("drops public users with 0 points AND 0 verified submissions", () => {
    const input = baseInput();
    input.users = [
      { stakeAddress: "stake1a", profileVisibility: "public" },
      { stakeAddress: "stake1empty", profileVisibility: "public" },
    ];
    input.ledger = [{ userId: "stake1a", delta: 5 }];
    const board = rankLeaderboardRows(input, 10);
    expect(board.map((r) => r.stakeAddress)).toEqual(["stake1a"]);
  });

  it("keeps a user with 0 points but a verified submission (manual_review with points=0)", () => {
    const input = baseInput();
    input.users = [{ stakeAddress: "stake1a", profileVisibility: "public" }];
    input.tasks = [{ id: "t1", projectId: "p1" }];
    input.submissions = [{ userId: "stake1a", taskId: "t1", status: "verified" }];
    const board = rankLeaderboardRows(input, 10);
    expect(board).toHaveLength(1);
    expect(board[0].verifiedSubmissions).toBe(1);
  });
});

describe("points: KV-cached leaderboard", () => {
  beforeEach(() => {
    kvStore.clear();
    kvGet.mockClear();
    kvPut.mockClear();
  });

  it("returns the cached rows when fresh", async () => {
    const cached = { fetchedAt: Date.now(), rows: [{ rank: 1, stakeAddress: "stake1a", totalPoints: 50, verifiedSubmissions: 1, projectsEngaged: 1 }] };
    kvStore.set("leaderboard:top-100", JSON.stringify(cached));
    const rows = await getCachedLeaderboard(100);
    expect(rows).toEqual(cached.rows);
    // Only the read happened — no recompute write
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("recomputes + writes when cache is stale", async () => {
    const stale = { fetchedAt: Date.now() - 5 * 60_000, rows: [{ rank: 1, stakeAddress: "stake1a", totalPoints: 1, verifiedSubmissions: 1, projectsEngaged: 1 }] };
    kvStore.set("leaderboard:top-100", JSON.stringify(stale));
    await getCachedLeaderboard(100);
    expect(kvPut).toHaveBeenCalledOnce();
    const written = JSON.parse(kvStore.get("leaderboard:top-100")!);
    expect(written.fetchedAt).toBeGreaterThan(stale.fetchedAt);
  });

  it("recomputes + writes when cache is empty", async () => {
    await getCachedLeaderboard(100);
    expect(kvPut).toHaveBeenCalledOnce();
  });

  it("refreshLeaderboardCache writes fresh rows + fetchedAt", async () => {
    await refreshLeaderboardCache(100);
    const v = JSON.parse(kvStore.get("leaderboard:top-100")!);
    expect(typeof v.fetchedAt).toBe("number");
    expect(Array.isArray(v.rows)).toBe(true);
  });
});

describe("points: getRankFor", () => {
  beforeEach(() => {
    dbResultsQueue.length = 0;
  });

  it("returns null for an unknown user (no row)", async () => {
    // First query (me lookup) returns empty.
    dbResultsQueue.push([]);
    const r = await getRankFor("stake1unknown");
    expect(r).toBeNull();
  });

  it("returns null when user has zero points and zero verified submissions", async () => {
    dbResultsQueue.push([
      { stakeAddress: "stake1a", profileVisibility: "public", totalPoints: 0, verifiedSubmissions: 0, projectsEngaged: 0 },
    ]);
    const r = await getRankFor("stake1a");
    expect(r).toBeNull();
  });

  it("computes rank = 1 + (count of users with strictly more points)", async () => {
    // 1st result: the user's own stats
    dbResultsQueue.push([
      { stakeAddress: "stake1a", profileVisibility: "public", totalPoints: 42, verifiedSubmissions: 3, projectsEngaged: 2 },
    ]);
    // 2nd result: count of users above them
    dbResultsQueue.push([{ n: 117 }]);
    const r = await getRankFor("stake1a");
    expect(r).toEqual({ rank: 118, totalPoints: 42, verifiedSubmissions: 3, projectsEngaged: 2 });
  });

  it("returns rank 1 when nobody has more points", async () => {
    dbResultsQueue.push([
      { stakeAddress: "stake1leader", profileVisibility: "public", totalPoints: 9999, verifiedSubmissions: 10, projectsEngaged: 5 },
    ]);
    dbResultsQueue.push([{ n: 0 }]);
    const r = await getRankFor("stake1leader");
    expect(r?.rank).toBe(1);
  });
});

describe("points: rankLeaderboardRows counts verified submissions + distinct projects", () => {
  it("counts only verified submissions and distinct projects engaged", () => {
    const input = baseInput();
    input.users = [{ stakeAddress: "stake1a", profileVisibility: "public" }];
    input.tasks = [
      { id: "t1", projectId: "proj-x" },
      { id: "t2", projectId: "proj-x" },
      { id: "t3", projectId: "proj-y" },
    ];
    input.submissions = [
      { userId: "stake1a", taskId: "t1", status: "verified" },
      { userId: "stake1a", taskId: "t2", status: "verified" },
      { userId: "stake1a", taskId: "t3", status: "verified" },
      { userId: "stake1a", taskId: "t1", status: "pending" }, // ignored
      { userId: "stake1a", taskId: "t1", status: "rejected" }, // ignored
    ];
    input.ledger = [{ userId: "stake1a", delta: 30 }];
    const board = rankLeaderboardRows(input, 10);
    expect(board[0].verifiedSubmissions).toBe(3);
    expect(board[0].projectsEngaged).toBe(2);
  });
});
