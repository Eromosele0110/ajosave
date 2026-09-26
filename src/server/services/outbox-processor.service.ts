/**
 * Outbox Processor Service
 *
 * Polls the `outbox_events` table for pending events and dispatches each one
 * to the appropriate handler (SMS, email, webhook, …).
 *
 * Designed to be called by the cron endpoint at
 * POST /api/v1/cron/process-outbox
 *
 * Processing guarantees:
 *   - Each event is locked with FOR UPDATE SKIP LOCKED, so multiple concurrent
 *     invocations of processOutboxEvents() will each claim a disjoint set.
 *   - On success  → status transitions to 'delivered'.
 *   - On failure  → attempts++ / last_error stored; once maxAttempts is
 *                    exceeded the event moves to 'dead' (dead-letter).
 *   - Transient failures are not thrown — they are logged and the event will
 *     be retried on the next poll cycle.
 */

import logger from "@/lib/logger";
import {
  getPendingEvents,
  markEventProcessed,
  markEventFailed,
  type OutboxEvent,
} from "@/lib/outbox";
import { notifyPayoutProcessed, notifyPayoutReminder, notifyContributionReminder, notifyMissedContribution } from "@/server/services/notification.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessOutboxResult {
  /** How many events were attempted in this run. */
  processed: number;
  /** How many events were delivered successfully. */
  succeeded: number;
  /** How many events failed delivery (will be retried or moved to dead). */
  failed: number;
}

// ---------------------------------------------------------------------------
// Event handler dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a single outbox event to the correct handler.
 * Throws on unrecoverable errors; the caller catches and calls markEventFailed.
 */
async function dispatchEvent(event: OutboxEvent): Promise<void> {
  const { aggregate_type, event_type, payload } = event;

  switch (event_type) {
    // ── Payout events ────────────────────────────────────────────────────────
    case "payout.processed": {
      const { memberUserIds, circleName, amount, recipientName } = payload as {
        memberUserIds: string[];
        circleName: string;
        amount: string;
        recipientName: string;
      };
      await notifyPayoutProcessed(memberUserIds, circleName, amount, recipientName);
      break;
    }

    case "payout.reminder": {
      const { userId, circleName, amount, hoursUntilPayout } = payload as {
        userId: string;
        circleName: string;
        amount: string;
        hoursUntilPayout: number;
      };
      await notifyPayoutReminder(userId, circleName, amount, hoursUntilPayout);
      break;
    }

    // ── Contribution events ──────────────────────────────────────────────────
    case "contribution.reminder": {
      const { userId, circleName, amount, hoursLeft } = payload as {
        userId: string;
        circleName: string;
        amount: string;
        hoursLeft: number;
      };
      await notifyContributionReminder(userId, circleName, amount, hoursLeft);
      break;
    }

    case "contribution.missed": {
      const { userId, circleName, amount } = payload as {
        userId: string;
        circleName: string;
        amount: string;
      };
      await notifyMissedContribution(userId, circleName, amount);
      break;
    }

    // ── Unknown event — log and skip (do not retry indefinitely) ────────────
    default: {
      logger.warn(
        { aggregate_type, event_type, eventId: event.id },
        "[outbox-processor] Unknown event type — marking as delivered to avoid infinite retry"
      );
      // Intentionally treated as success to avoid dead-letter flooding.
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

const BATCH_LIMIT = parseInt(process.env.OUTBOX_BATCH_LIMIT ?? "50", 10);
const MAX_ATTEMPTS = parseInt(process.env.OUTBOX_MAX_ATTEMPTS ?? "5", 10);

/**
 * Fetch and process a batch of pending outbox events.
 *
 * Errors from individual event handlers are caught and recorded without
 * aborting the rest of the batch.
 *
 * @returns Summary counts for observability / cron response bodies.
 */
export async function processOutboxEvents(): Promise<ProcessOutboxResult> {
  const result: ProcessOutboxResult = { processed: 0, succeeded: 0, failed: 0 };

  const events = await getPendingEvents(BATCH_LIMIT);

  if (events.length === 0) {
    logger.debug("[outbox-processor] No pending events");
    return result;
  }

  logger.info({ count: events.length }, "[outbox-processor] Processing outbox batch");

  for (const event of events) {
    result.processed++;

    try {
      await dispatchEvent(event);
      await markEventProcessed(event.id);
      result.succeeded++;

      logger.info(
        { eventId: event.id, eventType: event.event_type, aggregateType: event.aggregate_type },
        "[outbox-processor] Event delivered"
      );
    } catch (err) {
      result.failed++;

      const errorMessage = err instanceof Error ? err.message : String(err);

      logger.error(
        {
          eventId: event.id,
          eventType: event.event_type,
          aggregateType: event.aggregate_type,
          attempt: event.attempts + 1,
          error: errorMessage,
        },
        "[outbox-processor] Event delivery failed"
      );

      await markEventFailed(event.id, errorMessage, MAX_ATTEMPTS);
    }
  }

  logger.info(result, "[outbox-processor] Batch complete");

  return result;
}
