import { and, desc, eq, sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { auditLog, pointsLedger, projects, submissions, tasks, users } from "@/db/schema";

/**
 * Append-only points ledger helpers.
 *
 * NEVER UPDATE rows in points_ledger. To roll back, append a new row with
 * a negative delta and an appropriate reason (`clawback` or `admin_adjust`).
 * A user's total is `SUM(delta)`.
 *
 * Used by:
 *   - admin submission approve action (delta=task.points, reason='task_verified')
 *   - admin manual adjust action (any delta, reason='admin_adjust')
 *   - Phase 2 cron clawback on un-delegation (negative delta, reason='clawback')
 *
 * Pure-logic helpers (sumDeltas, rankLeaderboardRows, validateDelta) are
 * unit-tested in points.test.ts without a DB. DB-touching wrappers below
 * pass their arguments through those helpers and then issue Drizzle calls.
 */

export type PointsReason =
  | "task_verified"
  | "referral_bonus"
  | "admin_adjust"
  | "clawback";

// --------------- pure helpers (unit-tested) ---------------

export interface LedgerRowInput {
  userId: string;
  delta: number;
  reason: PointsReason;
  submissionId?: string | null;
  note?: string | null;
}

/**
 * Validate a delta: must be a finite integer. Returns the validated value
 * or null when it's a no-op (zero delta — caller should skip the insert).
 * Throws `points_delta_must_be_integer` for non-integer / non-finite values.
 */
export function validateDelta(delta: number): number | null {
  if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
    throw new Error("points_delta_must_be_integer");
  }
  if (delta === 0) return null;
  return delta;
}

/** Sum an array of ledger rows (positive + negative deltas). */
export function sumDeltas(rows: ReadonlyArray<{ delta: number }>): number {
  return rows.reduce((acc, r) => acc + r.delta, 0);
}

export interface LeaderboardRow {
  rank: number;
  stakeAddress: string;
  totalPoints: number;
  verifiedSubmissions: number;
  projectsEngaged: number;
}

export interface LeaderboardInput {
  users: ReadonlyArray<{ stakeAddress: string; profileVisibility: string }>;
  ledger: ReadonlyArray<{ userId: string; delta: number }>;
  submissions: ReadonlyArray<{ userId: string; taskId: string; status: string }>;
  tasks: ReadonlyArray<{ id: string; projectId: string }>;
}

/**
 * Pure leaderboard computation: aggregates points + verified counts +
 * distinct projects per user, filters by `profileVisibility='public'`,
 * sorts desc by total, drops users with zero activity, returns top N
 * with 1-based rank assigned in JS.
 *
 * The production query in `getPointsLeaderboard()` does the same shape
 * directly in SQL. This pure version lets us test ordering, privacy
 * filtering, and the zero-activity drop without a DB.
 */
export function rankLeaderboardRows(input: LeaderboardInput, limit: number): LeaderboardRow[] {
  const publicUsers = input.users.filter((u) => u.profileVisibility === "public");
  const taskById = new Map(input.tasks.map((t) => [t.id, t.projectId]));
  const enriched = publicUsers.map((u) => {
    const total = input.ledger.filter((r) => r.userId === u.stakeAddress).reduce((a, r) => a + r.delta, 0);
    const verified = input.submissions.filter((s) => s.userId === u.stakeAddress && s.status === "verified");
    const projects = new Set(
      verified.map((s) => taskById.get(s.taskId)).filter((p): p is string => !!p),
    );
    return {
      stakeAddress: u.stakeAddress,
      totalPoints: total,
      verifiedSubmissions: verified.length,
      projectsEngaged: projects.size,
    };
  });
  return enriched
    .filter((r) => r.totalPoints !== 0 || r.verifiedSubmissions > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

// --------------- DB wrappers ---------------

export async function appendPoints(opts: LedgerRowInput): Promise<void> {
  const delta = validateDelta(opts.delta);
  if (delta == null) return;
  await getDb().insert(pointsLedger).values({
    userId: opts.userId,
    delta,
    reason: opts.reason,
    submissionId: opts.submissionId ?? null,
    note: opts.note ?? null,
  });
}

export async function getPointsFor(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ total: sql<number>`COALESCE(SUM(${pointsLedger.delta}), 0)` })
    .from(pointsLedger)
    .where(eq(pointsLedger.userId, userId));
  return Number(rows[0]?.total ?? 0);
}

/**
 * Top-N public leaderboard rows. Direct SQL aggregation — Phase 2 will
 * add a KV cache on top (see CLAUDE.md § Verification flow).
 */
export async function getPointsLeaderboard(limit = 100): Promise<LeaderboardRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      stakeAddress: users.stakeAddress,
      totalPoints: sql<number>`COALESCE((SELECT SUM(delta) FROM points_ledger WHERE points_ledger.user_id = users.stake_address), 0)`,
      verifiedSubmissions: sql<number>`COALESCE((SELECT COUNT(*) FROM submissions WHERE submissions.user_id = users.stake_address AND submissions.status = 'verified'), 0)`,
      projectsEngaged: sql<number>`COALESCE((SELECT COUNT(DISTINCT t.project_id) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.user_id = users.stake_address AND s.status = 'verified'), 0)`,
    })
    .from(users)
    .where(eq(users.profileVisibility, "public"))
    // SQLite cannot resolve `total_points` here — Drizzle does not emit an
    // `AS` alias on these subquery columns, so we order by the same SUM
    // expression directly. Verified against `wrangler tail` (the previous
    // `desc(sql\`total_points\`)` returned 500 with "no such column").
    .orderBy(desc(sql`COALESCE((SELECT SUM(delta) FROM points_ledger WHERE points_ledger.user_id = users.stake_address), 0)`))
    .limit(limit);

  return rows
    .map((r) => ({
      stakeAddress: r.stakeAddress,
      totalPoints: Number(r.totalPoints ?? 0),
      verifiedSubmissions: Number(r.verifiedSubmissions ?? 0),
      projectsEngaged: Number(r.projectsEngaged ?? 0),
    }))
    .filter((r) => r.totalPoints !== 0 || r.verifiedSubmissions > 0)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

// ---------------- KV cache for the public leaderboard ----------------

const KV_LEADERBOARD_PREFIX = "leaderboard:top-";
// Read-side staleness window. The hourly cron is the primary writer; this
// is a cold-start backstop. Bumped from 60s → 5min because Cloudflare KV
// free tier is 1k writes/day per namespace, and every RSC prefetch hitting
// the page within the freshness window would otherwise re-write the cache.
// Five minutes keeps the page fresh enough for a leaderboard while staying
// well under the daily write quota.
const READ_FRESHNESS_MS = 5 * 60 * 1000;
// Write TTL — long enough that stale cron writes can't displace fresh ones,
// short enough that cache entries auto-evict if the cron stops running.
const WRITE_TTL_SECONDS = 65 * 60;

interface CachedLeaderboard {
  fetchedAt: number;
  rows: LeaderboardRow[];
}

interface KvLike {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function getKv(): KvLike | null {
  try {
    const { env } = getCloudflareContext();
    return ((env as unknown as { KV?: KvLike }).KV) ?? null;
  } catch {
    // No Cloudflare context (e.g. unit tests that didn't mock it). Caller
    // falls back to the uncached path.
    return null;
  }
}

/**
 * Get the top-N leaderboard rows from KV when fresh, else compute + write.
 * The hourly cron also refreshes; this is the read-side backstop so a cold
 * cache after eviction doesn't hammer D1 from page renders.
 */
export async function getCachedLeaderboard(limit = 100): Promise<LeaderboardRow[]> {
  const kv = getKv();
  if (!kv) return getPointsLeaderboard(limit);
  const key = `${KV_LEADERBOARD_PREFIX}${limit}`;
  let hit: CachedLeaderboard | null = null;
  try {
    hit = await kv.get<CachedLeaderboard>(key, "json");
  } catch (e) {
    console.warn("[leaderboard] kv.get failed, falling back to D1", e instanceof Error ? e.message : e);
  }
  if (hit && typeof hit.fetchedAt === "number" && Date.now() - hit.fetchedAt < READ_FRESHNESS_MS) {
    return hit.rows;
  }
  const rows = await getPointsLeaderboard(limit);
  // KV.put failures are never fatal — Cloudflare KV free tier is 1k
  // writes/day per namespace, and hitting that cap should not 500 the
  // public leaderboard. The hourly cron will refresh again on the next
  // tick (which counts as a single write per limit). For now serve the
  // freshly-computed rows directly.
  try {
    await kv.put(key, JSON.stringify({ fetchedAt: Date.now(), rows }), { expirationTtl: WRITE_TTL_SECONDS });
  } catch (e) {
    console.warn("[leaderboard] kv.put failed, serving direct", e instanceof Error ? e.message : e);
  }
  return rows;
}

/**
 * Invalidate + recompute the cached leaderboard. Called by the hourly cron
 * tick (`5 * * * *`). Safe to call any time.
 */
export async function refreshLeaderboardCache(limit = 100): Promise<void> {
  const kv = getKv();
  if (!kv) {
    // No KV bound — recompute purely for the side-effect of warming any
    // downstream caches. In production this branch shouldn't hit.
    await getPointsLeaderboard(limit);
    return;
  }
  const rows = await getPointsLeaderboard(limit);
  const key = `${KV_LEADERBOARD_PREFIX}${limit}`;
  try {
    await kv.put(key, JSON.stringify({ fetchedAt: Date.now(), rows }), { expirationTtl: WRITE_TTL_SECONDS });
    console.log("[leaderboard] kv cache refreshed", { limit, rowCount: rows.length });
  } catch (e) {
    // Most likely "KV put() limit exceeded for the day" on free tier.
    // Cron will try again on the next tick; nothing else to do.
    console.warn("[leaderboard] kv.put failed during cron refresh", e instanceof Error ? e.message : e);
  }
}

/**
 * Recent submissions for a single user — used on /me. Limit defaults to 10.
 */
export async function getRecentSubmissionsFor(userId: string, limit = 10) {
  const db = getDb();
  const rows = await db
    .select({
      submissionId: submissions.id,
      taskId: submissions.taskId,
      status: submissions.status,
      submittedAt: submissions.submittedAt,
      verifiedAt: submissions.verifiedAt,
      proofUrl: submissions.proofUrl,
    })
    .from(submissions)
    .where(eq(submissions.userId, userId))
    .orderBy(desc(submissions.submittedAt))
    .limit(limit);
  return rows;
}

export async function getVerifiedCountFor(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(submissions)
    .where(and(eq(submissions.userId, userId), eq(submissions.status, "verified")));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Resolve a single user's leaderboard standing. Used to render the "you're
 * outside top 100" footer on /leaderboard. Pure D1 — no KV churn, since
 * this lookup is per-user and the 5-min KV cache only covers the top-100
 * list. Returns null when the user has no activity (zero points AND zero
 * verified submissions) — they're not on the leaderboard at all.
 *
 * Rank is computed as: 1 + (count of public users with strictly more
 * points than this user). Ties get the same numeric rank position as the
 * SQL ORDER BY desc would assign (we do not implement dense_rank).
 */
export async function getRankFor(stakeAddress: string): Promise<
  | { rank: number; totalPoints: number; verifiedSubmissions: number; projectsEngaged: number }
  | null
> {
  const db = getDb();
  const meRows = await db
    .select({
      stakeAddress: users.stakeAddress,
      profileVisibility: users.profileVisibility,
      totalPoints: sql<number>`COALESCE((SELECT SUM(delta) FROM points_ledger WHERE points_ledger.user_id = users.stake_address), 0)`,
      verifiedSubmissions: sql<number>`COALESCE((SELECT COUNT(*) FROM submissions WHERE submissions.user_id = users.stake_address AND submissions.status = 'verified'), 0)`,
      projectsEngaged: sql<number>`COALESCE((SELECT COUNT(DISTINCT t.project_id) FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.user_id = users.stake_address AND s.status = 'verified'), 0)`,
    })
    .from(users)
    .where(eq(users.stakeAddress, stakeAddress))
    .limit(1);

  const me = meRows[0];
  if (!me) return null;
  const totalPoints = Number(me.totalPoints ?? 0);
  const verifiedSubmissions = Number(me.verifiedSubmissions ?? 0);
  const projectsEngaged = Number(me.projectsEngaged ?? 0);
  if (totalPoints === 0 && verifiedSubmissions === 0) return null;

  // Strictly more points than this user, among public profiles. Private
  // users are excluded from the leaderboard universe entirely (matches
  // `getPointsLeaderboard`'s WHERE clause).
  const aboveRows = await db
    .select({
      n: sql<number>`COUNT(*)`,
    })
    .from(users)
    .where(
      and(
        eq(users.profileVisibility, "public"),
        sql`COALESCE((SELECT SUM(delta) FROM points_ledger WHERE points_ledger.user_id = users.stake_address), 0) > ${totalPoints}`,
      ),
    );
  const above = Number(aboveRows[0]?.n ?? 0);
  return { rank: above + 1, totalPoints, verifiedSubmissions, projectsEngaged };
}

export interface LatestTaskRow {
  taskId: string;
  taskTitle: string;
  taskType: string;
  points: number;
  projectId: string;
  projectName: string;
  createdAt: number; // ms epoch
}

/**
 * Latest tasks added across the platform, sourced from the audit log
 * (`entity_type='task'`, `field='_create'`). Joins to tasks + projects.
 * Filters to active tasks only. Falls back to ordering active tasks by
 * `displayOrder DESC, id` when no audit rows exist (fresh DB / audit
 * pipeline broken). Capped at `limit`.
 */
export async function getLatestTasksAdded(limit = 10): Promise<LatestTaskRow[]> {
  const db = getDb();
  const auditRows = await db
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskType: tasks.taskType,
      points: tasks.points,
      projectId: projects.id,
      projectName: projects.name,
      createdAt: auditLog.timestamp,
    })
    .from(auditLog)
    .innerJoin(tasks, eq(tasks.id, auditLog.entityId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(auditLog.entityType, "task"),
        eq(auditLog.field, "_create"),
        eq(tasks.status, "active"),
      ),
    )
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);

  if (auditRows.length > 0) {
    return auditRows.map((r) => ({
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      taskType: r.taskType,
      points: Number(r.points ?? 0),
      projectId: r.projectId,
      projectName: r.projectName,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt ?? 0),
    }));
  }

  console.warn("[leaderboard:latest-tasks] audit empty, falling back to displayOrder");
  const fallbackRows = await db
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskType: tasks.taskType,
      points: tasks.points,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.status, "active"))
    .orderBy(desc(tasks.displayOrder), tasks.id)
    .limit(limit);

  return fallbackRows.map((r) => ({
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    taskType: r.taskType,
    points: Number(r.points ?? 0),
    projectId: r.projectId,
    projectName: r.projectName,
    createdAt: 0,
  }));
}

export async function getProjectsEngagedFor(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ projectId: tasks.projectId })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .where(and(eq(submissions.userId, userId), eq(submissions.status, "verified")));
  const distinct = new Set(rows.map((r) => r.projectId));
  return distinct.size;
}
