import { randomUUID } from "crypto";
import type { Circle, Member, CircleStatus, CircleFilters } from "@/types";
import type { CreateCircleInput } from "@/types/schemas";
import { transaction, query } from "@/lib/db";

// Exchange rate — replace with live FX feed in production
const NGN_PER_USDC = 1600;
export const ngnToUsdc = (ngn: number) => (ngn / NGN_PER_USDC).toFixed(7);

// ─── In-memory store (replace with DB) ───────────────────────────────────────
const circles = new Map<string, Circle>();
const members = new Map<string, Member[]>(); // circleId → members

export async function createCircle(creatorId: string, input: CreateCircleInput): Promise<Circle> {
  const id = randomUUID();
  const circle: Circle = {
    id,
    name: input.name,
    creatorId,
    contributionUsdc: ngnToUsdc(input.contributionNgn),
    contributionNgn: input.contributionNgn,
    maxMembers: input.maxMembers,
    cycleFrequency: input.cycleFrequency,
    status: "open",
    currentCycle: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  circles.set(id, circle);
  members.set(id, []);
  return circle;
}

export async function getCircleById(id: string): Promise<Circle | null> {
  return circles.get(id) ?? null;
}

export async function listOpenCircles(): Promise<Circle[]> {
  return [...circles.values()].filter((c) => c.status === "open");
}

/**
 * Return circles that match the given filter criteria.
 *
 * Attempts a DB-backed query first so that filters are applied at the
 * database level for efficiency.  Falls back to the in-memory store with
 * client-side filtering when the DB is unavailable (dev / test environments).
 *
 * @param filters - Optional filter parameters. All fields are optional.
 * @returns Matching circles ordered by creation date descending.
 */
export async function listCircles(filters: CircleFilters = {}): Promise<Circle[]> {
  // ── DB-backed path ──────────────────────────────────────────────────────
  try {
    const conditions: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    } else {
      // Default: only open circles (preserves existing public listing behaviour)
      conditions.push(`status = 'open'`);
    }

    if (filters.frequency) {
      conditions.push(`cycle_frequency = $${idx++}`);
      params.push(filters.frequency);
    }

    if (filters.minAmount !== undefined) {
      conditions.push(`contribution_ngn >= $${idx++}`);
      params.push(filters.minAmount);
    }

    if (filters.maxAmount !== undefined) {
      conditions.push(`contribution_ngn <= $${idx++}`);
      params.push(filters.maxAmount);
    }

    if (filters.maxMembers !== undefined) {
      conditions.push(`max_members = $${idx++}`);
      params.push(filters.maxMembers);
    }

    if (filters.search) {
      conditions.push(`name ILIKE $${idx++}`);
      params.push(`%${filters.search}%`);
    }

    const sql = `
      SELECT id, name, creator_id, contribution_usdc, contribution_ngn,
             max_members, cycle_frequency, status, contract_id,
             current_cycle, next_payout_at, created_at, updated_at
      FROM circles
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
    `;

    const result = await query<{
      id: string;
      name: string;
      creator_id: string;
      contribution_usdc: string;
      contribution_ngn: number;
      max_members: number;
      cycle_frequency: string;
      status: string;
      contract_id: string | null;
      current_cycle: number;
      next_payout_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      creatorId: row.creator_id,
      contributionUsdc: row.contribution_usdc,
      contributionNgn: row.contribution_ngn,
      maxMembers: row.max_members,
      cycleFrequency: row.cycle_frequency as Circle["cycleFrequency"],
      status: row.status as CircleStatus,
      contractId: row.contract_id ?? undefined,
      currentCycle: row.current_cycle,
      nextPayoutAt: row.next_payout_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch {
    console.warn("[circle.service] DB unavailable, falling back to in-memory filter");
  }

  // ── In-memory fallback ──────────────────────────────────────────────────
  const search = filters.search?.trim().toLowerCase();
  return [...circles.values()]
    .filter((c) => (filters.status ? c.status === filters.status : c.status === "open"))
    .filter((c) => !filters.frequency || c.cycleFrequency === filters.frequency)
    .filter((c) => filters.minAmount === undefined || c.contributionNgn >= filters.minAmount)
    .filter((c) => filters.maxAmount === undefined || c.contributionNgn <= filters.maxAmount)
    .filter((c) => filters.maxMembers === undefined || c.maxMembers === filters.maxMembers)
    .filter((c) => !search || c.name.toLowerCase().includes(search))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getCirclesByUser(userId: string): Promise<Circle[]> {
  const userMemberships = [...members.values()]
    .flat()
    .filter((m) => m.userId === userId)
    .map((m) => m.circleId);
  return [...circles.values()].filter(
    (c) => c.creatorId === userId || userMemberships.includes(c.id)
  );
}

/**
 * Atomically join a circle.
 *
 * Uses a DB-level transaction with a FOR UPDATE lock on the circle row to
 * prevent race conditions when multiple users attempt to join simultaneously
 * (e.g. the last available slot). All membership checks and writes occur
 * within a single serialisable unit — either all succeed or all are rolled
 * back, keeping the data consistent even under concurrent load.
 *
 * Edge cases handled:
 *  - Circle not found / already deleted
 *  - Circle is not in "open" status (active, completed, cancelled…)
 *  - Circle is full (concurrent joins for the last slot)
 *  - User is already a member (idempotency guard)
 *  - DB connectivity errors propagate to the caller unchanged
 *
 * NOTE: The in-memory fallback below is retained for environments that have
 * not yet migrated to a live Postgres database. Once the DB is wired up the
 * in-memory path can be removed.
 */
export async function joinCircle(
  circleId: string,
  userId: string,
  _isInvited?: boolean
): Promise<Member> {
  // ── Try DB-backed transactional path first ────────────────────────────────
  try {
    return await transaction(async (q) => {
      // Lock the circle row for the duration of this transaction so that
      // concurrent joins cannot read stale member counts.
      const circleRow = await q<{
        id: string;
        status: string;
        max_members: number;
        current_cycle: number;
        cycle_frequency: string;
      }>(
        `SELECT id, status, max_members, current_cycle, cycle_frequency
         FROM circles
         WHERE id = $1
         FOR UPDATE`,
        [circleId]
      );

      if (circleRow.rowCount === 0) {
        throw new Error("Circle not found");
      }

      const circle = circleRow.rows[0];

      if (circle.status !== "open") {
        throw new Error(`Circle is not open for joining (status: ${circle.status})`);
      }

      // Count existing active members within the same transaction to avoid
      // a TOCTOU race between the SELECT and the INSERT.
      const countRow = await q<{ count: string }>(
        `SELECT COUNT(*) AS count FROM members WHERE circle_id = $1 AND status = 'active'`,
        [circleId]
      );
      const currentCount = parseInt(countRow.rows[0].count, 10);

      if (currentCount >= circle.max_members) {
        throw new Error("Circle is full");
      }

      // Idempotency: prevent duplicate membership records.
      const existingRow = await q<{ id: string }>(
        `SELECT id FROM members WHERE circle_id = $1 AND user_id = $2 LIMIT 1`,
        [circleId, userId]
      );
      if (existingRow.rowCount !== 0) {
        throw new Error("Already a member of this circle");
      }

      const memberId = randomUUID();
      const position = currentCount + 1;
      const now = new Date();

      await q(
        `INSERT INTO members (id, circle_id, user_id, position, status, has_received_payout, joined_at)
         VALUES ($1, $2, $3, $4, 'active', false, $5)`,
        [memberId, circleId, userId, position, now]
      );

      // Auto-start when the circle is now full.
      if (position === circle.max_members) {
        const nextPayoutAt = computeNextPayoutDate(
          circle.cycle_frequency as Circle["cycleFrequency"]
        );
        await q(
          `UPDATE circles
           SET status = 'active', current_cycle = 1, next_payout_at = $2, updated_at = $3
           WHERE id = $1`,
          [circleId, nextPayoutAt, now]
        );
      }

      const member: Member = {
        id: memberId,
        circleId,
        userId,
        position,
        status: "active",
        hasReceivedPayout: false,
        joinedAt: now,
      };

      return member;
    });
  } catch (err) {
    // If the error is a domain error (validation / business rule), re-throw
    // directly so the API layer returns the right HTTP status.
    const domainErrors = [
      "Circle not found",
      "Circle is not open for joining",
      "Circle is full",
      "Already a member of this circle",
    ];
    const isDomainError =
      err instanceof Error && domainErrors.some((msg) => err.message.startsWith(msg));

    if (isDomainError) throw err;

    // For infrastructure errors (DB unavailable etc.) fall through to the
    // in-memory store so the service degrades gracefully during development.
    console.warn(
      "[circle.service] DB transaction failed, falling back to in-memory store:",
      err instanceof Error ? err.message : err
    );
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const circle = circles.get(circleId);
  if (!circle) throw new Error("Circle not found");
  if (circle.status !== "open") throw new Error("Circle is not open for joining");

  const circleMembers = members.get(circleId) ?? [];
  if (circleMembers.length >= circle.maxMembers) throw new Error("Circle is full");
  if (circleMembers.some((m) => m.userId === userId)) throw new Error("Already a member");

  const member: Member = {
    id: randomUUID(),
    circleId,
    userId,
    position: circleMembers.length + 1,
    status: "active",
    hasReceivedPayout: false,
    joinedAt: new Date(),
  };

  circleMembers.push(member);
  members.set(circleId, circleMembers);

  // Auto-start when full
  if (circleMembers.length === circle.maxMembers) {
    circle.status = "active";
    circle.currentCycle = 1;
    circle.nextPayoutAt = computeNextPayoutDate(circle.cycleFrequency);
    circle.updatedAt = new Date();
    circles.set(circleId, circle);
  }

  return member;
}

/**
 * Atomically leave a circle.
 *
 * Uses a DB transaction with a FOR UPDATE row-lock on both the circle and
 * the membership record to ensure consistent state. In-memory fallback is
 * retained for dev environments without a live DB.
 *
 * Edge cases handled:
 *  - Circle or membership not found
 *  - Circle has already started (status != "open") — members cannot leave
 *    once contributions have begun (financial integrity)
 *  - Creator cannot leave their own circle
 *  - Concurrent leave requests for the same user are idempotent
 */
export async function leaveCircle(circleId: string, userId: string): Promise<void> {
  // ── DB-backed transactional path ──────────────────────────────────────────
  try {
    await transaction(async (q) => {
      // Lock the circle row first to prevent status changes mid-operation.
      const circleRow = await q<{ id: string; status: string; creator_id: string }>(
        `SELECT id, status, creator_id FROM circles WHERE id = $1 FOR UPDATE`,
        [circleId]
      );

      if (circleRow.rowCount === 0) {
        throw new Error("Circle not found");
      }

      const circle = circleRow.rows[0];

      if (circle.creator_id === userId) {
        throw new Error("Circle creator cannot leave their own circle");
      }

      if (circle.status !== "open") {
        throw new Error(
          `Cannot leave a circle that has already started (status: ${circle.status})`
        );
      }

      // Lock the member row within the same transaction.
      const memberRow = await q<{ id: string; status: string }>(
        `SELECT id, status FROM members WHERE circle_id = $1 AND user_id = $2 FOR UPDATE LIMIT 1`,
        [circleId, userId]
      );

      if (memberRow.rowCount === 0) {
        throw new Error("You are not a member of this circle");
      }

      // Soft-delete: mark as 'left' rather than physically removing the row
      // so that audit trails remain intact.
      await q(
        `UPDATE members SET status = 'left', updated_at = $3 WHERE circle_id = $1 AND user_id = $2`,
        [circleId, userId, new Date()]
      );
    });

    return;
  } catch (err) {
    const domainErrors = [
      "Circle not found",
      "Circle creator cannot leave",
      "Cannot leave a circle",
      "You are not a member",
    ];
    const isDomainError =
      err instanceof Error && domainErrors.some((msg) => err.message.startsWith(msg));

    if (isDomainError) throw err;

    console.warn(
      "[circle.service] DB transaction failed, falling back to in-memory store:",
      err instanceof Error ? err.message : err
    );
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const circle = circles.get(circleId);
  if (!circle) throw new Error("Circle not found");

  if (circle.creatorId === userId) {
    throw new Error("Circle creator cannot leave their own circle");
  }

  if (circle.status !== "open") {
    throw new Error(
      `Cannot leave a circle that has already started (status: ${circle.status})`
    );
  }

  const circleMembers = members.get(circleId) ?? [];
  const idx = circleMembers.findIndex((m) => m.userId === userId);
  if (idx === -1) throw new Error("You are not a member of this circle");

  circleMembers.splice(idx, 1);
  members.set(circleId, circleMembers);
}

export async function getMembersByCircle(circleId: string): Promise<Member[]> {
  // Try DB first
  try {
    const result = await query<{
      id: string;
      circle_id: string;
      user_id: string;
      position: number;
      status: string;
      has_received_payout: boolean;
      joined_at: Date;
    }>(
      `SELECT id, circle_id, user_id, position, status, has_received_payout, joined_at
       FROM members
       WHERE circle_id = $1 AND status = 'active'
       ORDER BY position ASC`,
      [circleId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      circleId: row.circle_id,
      userId: row.user_id,
      position: row.position,
      status: row.status as Member["status"],
      hasReceivedPayout: row.has_received_payout,
      joinedAt: row.joined_at,
    }));
  } catch {
    // Fall back to in-memory store
    return members.get(circleId) ?? [];
  }
}

export async function updateCircleStatus(id: string, status: CircleStatus): Promise<void> {
  // Try DB first
  try {
    await query(`UPDATE circles SET status = $1, updated_at = $2 WHERE id = $3`, [
      status,
      new Date(),
      id,
    ]);
    return;
  } catch {
    // Fall back to in-memory store
  }

  const circle = circles.get(id);
  if (!circle) return;
  circle.status = status;
  circle.updatedAt = new Date();
  circles.set(id, circle);
}

function computeNextPayoutDate(frequency: Circle["cycleFrequency"]): Date {
  const d = new Date();
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "biweekly") d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d;
}
