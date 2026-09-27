/**
 * Mutation concurrency checks using PostgreSQL advisory locks.
 *
 * Prevents two concurrent requests from mutating the same resource
 * (circle, member, payout) at the same time without needing a
 * dedicated lock table.
 *
 * pg_try_advisory_xact_lock acquires a transaction-level lock.
 * It is released automatically when the transaction ends — no
 * manual cleanup required.
 *
 * Usage (within a transaction):
 *   await transaction(async (q) => {
 *     await requireAdvisoryLock(q, "circle", circleId);
 *     // ... safe to mutate
 *   });
 *
 * Usage (outside a transaction, session-level):
 *   const released = await withAdvisoryLock("circle", circleId, async () => {
 *     // ... safe to mutate
 *   });
 */

import { query as globalQuery } from "@/lib/db";
import { Pool } from "pg";

// ─── Key hashing ─────────────────────────────────────────────────────────────

/**
 * Deterministically map a (namespace, id) pair to a 64-bit advisory lock key.
 * We use a simple djb2-inspired hash — collisions are theoretically possible
 * but vanishingly unlikely for the expected key space.
 */
export function advisoryLockKey(namespace: string, id: string): bigint {
  const raw = `${namespace}:${id}`;
  let h = 5381n;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5n) + h + BigInt(raw.charCodeAt(i))) & 0xffff_ffff_ffff_ffffn;
  }
  // Keep within signed int8 range postgres expects
  return h > 0x7fff_ffff_ffff_ffffn ? h - 0x1_0000_0000_0000_0000n : h;
}

// ─── Transaction-level advisory lock ─────────────────────────────────────────

export class ConcurrencyError extends Error {
  constructor(namespace: string, id: string) {
    super(`Concurrent mutation detected for ${namespace}:${id} — please retry`);
    this.name = "ConcurrencyError";
  }
}

type BoundQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/**
 * Acquire a transaction-level advisory lock inside an existing transaction.
 * Throws ConcurrencyError if another transaction already holds the lock.
 *
 * Must be called with the bound query function passed to `transaction(fn)`.
 */
export async function requireAdvisoryLock(
  q: BoundQuery,
  namespace: string,
  id: string
): Promise<void> {
  const key = advisoryLockKey(namespace, id);
  const { rows } = await q(`SELECT pg_try_advisory_xact_lock($1) AS acquired`, [key]);
  if (!rows[0]?.acquired) {
    throw new ConcurrencyError(namespace, id);
  }
}

// ─── Session-level advisory lock ─────────────────────────────────────────────

/**
 * Acquire a session-level advisory lock, run fn, then release.
 * Use this when you cannot easily wrap work in a DB transaction.
 *
 * Throws ConcurrencyError if the lock is already held.
 */
export async function withAdvisoryLock<T>(
  namespace: string,
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = advisoryLockKey(namespace, id);

  // Session-level locks must be acquired and released on the same connection
  const { rows } = await globalQuery(
    `SELECT pg_try_advisory_lock($1) AS acquired`,
    [key]
  );

  if (!rows[0]?.acquired) {
    throw new ConcurrencyError(namespace, id);
  }

  try {
    return await fn();
  } finally {
    await globalQuery(`SELECT pg_advisory_unlock($1)`, [key]);
  }
}
