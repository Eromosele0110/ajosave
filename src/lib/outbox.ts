/**
 * Transactional Outbox — core data-access layer.
 *
 * Outbox events are inserted in the same DB transaction as the business
 * operation that produces them. A background processor polls for pending
 * events and delivers them to external systems (SMS, email, webhooks).
 *
 * All writes MUST use parameterised queries. Never interpolate user input.
 *
 * Usage inside a transaction:
 *   await transaction(async (q) => {
 *     await q("UPDATE circles SET ...", [...]);
 *     await enqueueEvent("circle", circleId, "payout.processed", payload, q);
 *   });
 *
 * Usage outside a transaction (fire-and-forget, best-effort):
 *   await enqueueEvent("user", userId, "user.registered", payload);
 */

import { query as defaultQuery } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";

/** Matches the columns of the `outbox_events` table. */
export interface OutboxEvent {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "dead";
  attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  processed_at: Date | null;
  created_at: Date;
}

/** The query function signature exported from `@/lib/db`. */
type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LIMIT = 100;

/**
 * Insert an outbox event, optionally within an existing transaction.
 *
 * @param aggregateType - Domain entity type (e.g. "circle", "user")
 * @param aggregateId   - ID of the entity
 * @param eventType     - Event name (e.g. "payout.processed")
 * @param payload       - Arbitrary JSON payload for the handler
 * @param q             - Optional bound query function from `transaction(fn)`.
 *                        Pass this to ensure the insert shares the caller's
 *                        transaction — if the transaction rolls back, the event
 *                        is never stored.
 */
export async function enqueueEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  q: QueryFn = defaultQuery
): Promise<OutboxEvent> {
  const { rows } = await q<OutboxEvent>(
    `INSERT INTO outbox_events
       (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)]
  );
  return rows[0];
}

/**
 * Fetch pending events ordered by `scheduled_at` ASC (oldest first).
 *
 * Uses `FOR UPDATE SKIP LOCKED` so that concurrent processors each claim
 * a distinct set of rows without contention.
 *
 * @param limit - Maximum number of rows to return (default: 100)
 */
export async function getPendingEvents(limit = DEFAULT_LIMIT): Promise<OutboxEvent[]> {
  const { rows } = await defaultQuery<OutboxEvent>(
    `SELECT *
       FROM outbox_events
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit]
  );
  return rows;
}

/**
 * Mark an event as successfully delivered.
 *
 * @param id - UUID of the outbox event
 */
export async function markEventProcessed(id: string): Promise<void> {
  await defaultQuery(
    `UPDATE outbox_events
        SET status = 'delivered',
            processed_at = NOW()
      WHERE id = $1`,
    [id]
  );
}

/**
 * Record a delivery failure.
 *
 * Increments `attempts` and stores the error message. If the event has
 * reached `maxAttempts`, it is moved to status `'dead'` (dead-letter queue)
 * so it no longer blocks the processor loop.
 *
 * @param id          - UUID of the outbox event
 * @param error       - Human-readable error description
 * @param maxAttempts - Attempt ceiling before marking dead (default: 5)
 */
export async function markEventFailed(
  id: string,
  error: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<void> {
  await defaultQuery(
    `UPDATE outbox_events
        SET attempts   = attempts + 1,
            last_error = $2,
            status     = CASE
                           WHEN attempts + 1 >= $3 THEN 'dead'
                           ELSE status
                         END
      WHERE id = $1`,
    [id, error, maxAttempts]
  );
}

/**
 * Reschedule a failed event for a future retry.
 *
 * Resets the status to `'pending'` and pushes `scheduled_at` forward by
 * `delayMs` milliseconds. This is typically called after a transient
 * failure, before the `maxAttempts` ceiling is reached.
 *
 * @param id      - UUID of the outbox event
 * @param delayMs - How far in the future to reschedule (default: 60 000 ms)
 */
export async function requeueEvent(id: string, delayMs = 60_000): Promise<void> {
  await defaultQuery(
    `UPDATE outbox_events
        SET status       = 'pending',
            scheduled_at = NOW() + ($2 * INTERVAL '1 millisecond')
      WHERE id = $1`,
    [id, delayMs]
  );
}
