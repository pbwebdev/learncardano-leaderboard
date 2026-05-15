import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pointsLedger, submissions, tasks, users } from "@/db/schema";

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
    .orderBy(desc(sql`total_points`))
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
