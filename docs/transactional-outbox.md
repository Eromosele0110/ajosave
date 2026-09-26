# Transactional Outbox Pattern

## Overview

The **transactional outbox** pattern guarantees that side-effects (SMS, email, webhook calls) are delivered exactly once, even if the application crashes between writing to the database and dispatching the external call.

Instead of calling external services inline, we write an *outbox event* to the `outbox_events` table in the **same database transaction** as the business operation. A background processor polls the table and delivers events asynchronously. If delivery fails, the event is retried up to a configurable limit before being moved to the dead-letter state.

```
Business Operation (DB transaction)
  ├─ UPDATE circles SET ...        ← main write
  └─ INSERT INTO outbox_events ... ← side-effect record (same tx)

Background Processor (cron, every minute)
  ├─ SELECT pending events FOR UPDATE SKIP LOCKED
  ├─ dispatchEvent(event) → SMS / Email / Webhook
  ├─ markEventProcessed(id)        ← on success
  └─ markEventFailed(id, error)    ← on failure (retry / dead-letter)
```

---

## Files

| Path | Purpose |
|---|---|
| `migrations/1790100000000_add-outbox-table.ts` | Adds the `outbox_events` table and indexes |
| `src/lib/outbox.ts` | Core data-access layer (enqueue, fetch, mark) |
| `src/lib/__tests__/outbox.test.ts` | Unit tests for `outbox.ts` |
| `src/server/services/outbox-processor.service.ts` | Background processor — dispatches events |
| `src/app/api/v1/cron/process-outbox/route.ts` | Cron endpoint that triggers one processing cycle |

---

## Database Schema

```sql
CREATE TABLE outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(100) NOT NULL,   -- e.g. 'circle', 'user'
  aggregate_id   VARCHAR(255) NOT NULL,   -- entity ID
  event_type     VARCHAR(100) NOT NULL,   -- e.g. 'payout.processed'
  payload        JSONB        NOT NULL,   -- arbitrary handler data
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
                                         -- pending | delivered | dead
  attempts       INTEGER      NOT NULL DEFAULT 0,
  last_error     TEXT,
  scheduled_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMP,
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX ON outbox_events (status, scheduled_at);
CREATE INDEX ON outbox_events (aggregate_type, aggregate_id);
```

---

## Usage

### 1. Enqueue an event inside a transaction

Use the `q` parameter to bind the insert to the caller's transaction. If the transaction rolls back, the event is never persisted.

```typescript
import { transaction } from "@/lib/db";
import { enqueueEvent } from "@/lib/outbox";

await transaction(async (q) => {
  // Business write
  await q(
    "UPDATE circles SET status = 'completed' WHERE id = $1",
    [circleId]
  );

  // Side-effect record — same transaction
  await enqueueEvent(
    "circle",
    circleId,
    "payout.processed",
    {
      memberUserIds: [...],
      circleName:   "Ikeja Savers",
      amount:       "50.0000000",
      recipientName: "Amaka O.",
    },
    q  // ← bind to this transaction
  );
});
```

### 2. Enqueue an event outside a transaction (fire-and-forget)

Omit the `q` parameter. The event will be committed immediately using the module-level `query` function.

```typescript
import { enqueueEvent } from "@/lib/outbox";

await enqueueEvent("user", userId, "user.registered", { phone });
```

### 3. Add a new event type

1. Add a handler `case` in `src/server/services/outbox-processor.service.ts` → `dispatchEvent()`.
2. Define the payload shape as an inline type in that case block.
3. Add a test in `src/lib/__tests__/outbox.test.ts` if the shape validation matters.

---

## Supported Event Types

| Event Type | Aggregate | Handler |
|---|---|---|
| `payout.processed` | `circle` | `notifyPayoutProcessed` |
| `payout.reminder` | `circle` | `notifyPayoutReminder` |
| `contribution.reminder` | `circle` | `notifyContributionReminder` |
| `contribution.missed` | `circle` | `notifyMissedContribution` |

Unknown event types are logged as a warning and marked `delivered` to avoid infinite retries. Register new types in `dispatchEvent` before enqueueing them.

---

## Retry & Dead-Letter Policy

| Attempt | Outcome |
|---|---|
| 1 – (maxAttempts − 1) | `status` stays `pending`; `attempts` incremented; `last_error` stored; retried on next cron run |
| maxAttempts | `status` → `dead` (dead-letter) |

Defaults (configurable via environment variables):

| Variable | Default | Description |
|---|---|---|
| `OUTBOX_MAX_ATTEMPTS` | `5` | Attempt ceiling before dead-lettering |
| `OUTBOX_BATCH_LIMIT` | `50` | Events processed per cron invocation |

To manually requeue a dead-letter event, call `requeueEvent(id)` from a migration, admin script, or REPL:

```typescript
import { requeueEvent } from "@/lib/outbox";
await requeueEvent("evt-uuid", 0); // schedule immediately
```

---

## Cron Endpoint

**`POST /api/v1/cron/process-outbox`**

Triggers one processing cycle. Responds with:

```json
{
  "success": true,
  "data": {
    "processed": 12,
    "succeeded": 11,
    "failed": 1
  }
}
```

### Authentication

The endpoint uses HMAC-SHA256 signed headers (see `src/lib/cron-auth.ts`).

```typescript
import { signRequest } from "@/lib/cron-auth";

const headers = signRequest("POST", "/api/v1/cron/process-outbox");
await fetch(`${baseUrl}/api/v1/cron/process-outbox`, {
  method: "POST",
  headers,
});
```

### Vercel Cron (recommended)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/v1/cron/process-outbox",
      "schedule": "* * * * *"
    }
  ]
}
```

---

## Observability

All processor events are logged with the structured `logger` (pino). Key log messages:

| Level | Message | Fields |
|---|---|---|
| `debug` | No pending events | — |
| `info` | Processing outbox batch | `count` |
| `info` | Event delivered | `eventId`, `eventType`, `aggregateType` |
| `error` | Event delivery failed | `eventId`, `eventType`, `attempt`, `error` |
| `info` | Batch complete | `processed`, `succeeded`, `failed` |

To monitor dead-letter events, run:

```sql
SELECT aggregate_type, event_type, attempts, last_error, created_at
  FROM outbox_events
 WHERE status = 'dead'
 ORDER BY created_at DESC;
```

---

## Concurrency Safety

`getPendingEvents` uses `SELECT … FOR UPDATE SKIP LOCKED`. Concurrent processor instances (e.g. multiple Vercel serverless function invocations) will each claim a disjoint set of rows, preventing double-delivery without a distributed lock.

---

## Testing

```bash
# Run unit tests
npx jest src/lib/__tests__/outbox.test.ts --no-coverage

# Run all related tests
npx jest outbox --no-coverage
```

The unit tests mock `@/lib/db` so no database connection is required.
