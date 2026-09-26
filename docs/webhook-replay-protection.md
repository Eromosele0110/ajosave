# Webhook Replay Protection

This document describes the multi-layer replay-attack protection applied to inbound Paystack webhooks.

---

## Why Replay Protection Matters

A webhook replay attack occurs when an attacker (or a misbehaving Paystack retry) re-sends a
previously-delivered webhook event.  Without protection this could cause:

- A contribution being credited **twice** for a single payment.
- Fraudulent "charge.success" events triggering circle payouts.
- Denial-of-service via high-volume event flooding.

---

## Defence Layers

The implementation (`src/app/api/v1/webhooks/paystack/route.ts`) applies **four independent layers**:

### 1. HMAC-SHA512 Signature Verification

Every inbound request must carry an `x-paystack-signature` header.  The server recomputes the
HMAC-SHA512 of the raw request body using the Paystack secret key and compares it to the header
value using **`timingSafeEqual`** from Node.js's built-in `crypto` module.

`timingSafeEqual` prevents timing side-channel attacks where an attacker could measure response
latency to learn how many bytes of the signature matched.

```
x-paystack-signature: <hex(HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY))>
```

**Utility:** `src/lib/webhook-replay.ts` → `verifyPaystackSignature()`

### 2. Timestamp Validation (Stale Event Rejection)

Paystack does not include a request timestamp header.  Instead, the event payload contains a
`created_at` field.  The server rejects any event whose `created_at` is more than **5 minutes**
in the past.

This prevents an attacker from capturing and replaying a valid signed webhook hours or days later.

- Maximum event age: **300 000 ms (5 minutes)**
- Clock-skew tolerance for future-dated events: **30 seconds**
- Accepted timestamp formats: ISO 8601 string, Unix seconds, or Unix milliseconds

**Utility:** `src/lib/webhook-replay.ts` → `validateWebhookTimestamp()`

### 3. Unique Event ID Extraction

Every Paystack event has a unique numeric `id` on the envelope.  The server extracts this ID
using a prioritised fallback chain:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `event.id` | `"123456"` |
| 2 | `event.data.id` | `"789012"` |
| 3 | `event.data.reference` (prefixed) | `"ref:ajo-circle-1-member-1-2"` |
| 4 | SHA-256 hash of full payload | `"a3f9…"` |

**Utility:** `src/lib/webhook-replay.ts` → `extractEventId()`

### 4. Database-Level Idempotency (`processed_webhooks` table)

After passing all prior checks, the server queries the `processed_webhooks` table:

```sql
SELECT id FROM processed_webhooks
WHERE id = $1
  AND provider = 'paystack'
  AND created_at >= NOW() - INTERVAL '24 HOURS'
```

If a matching row exists the event is a duplicate and a `200 { received: true, duplicate: true }`
response is returned immediately.

For `charge.success` events the **INSERT into `processed_webhooks`** happens inside the same
database transaction as the contribution update, so it is impossible for an event to be
processed without being recorded, or to be recorded without processing completing.

A unique constraint on `(provider, id)` also catches any race condition between concurrent
requests carrying the same event (returns HTTP 200 with `duplicate: true`).

---

## Migration

`migrations/1790200000000_processed-webhooks-timestamp-index.ts` adds:

1. **`created_at` index** — speeds up the deduplication window query and TTL-based cleanup jobs.
2. **`expires_at` column** — nullable timestamp allowing the application to stamp an explicit
   expiry date at insert time for a future background-cleanup job.

---

## Configuration

| Parameter | Default | Environment Variable |
|-----------|---------|----------------------|
| Paystack secret key | — | `PAYSTACK_SECRET_KEY` |
| Max webhook age | 5 minutes | Hard-coded in `DEFAULT_MAX_AGE_MS` |
| DB deduplication window | 24 hours | Hard-coded in SQL |

To adjust the timestamp window, pass a custom `maxAgeMs` value to `validateWebhookTimestamp()`.

---

## Testing

Unit tests live in `src/lib/__tests__/webhook-replay.test.ts` and cover:

- `verifyPaystackSignature` — valid/invalid signatures, timing-safe comparison, edge cases
- `validateWebhookTimestamp` — ISO 8601, Unix seconds/ms, stale events, future events, invalid input
- `extractEventId` — all four fallback levels, deterministic hashing, edge cases
- Integration scenario — all three utilities combined for a fresh vs. stale vs. bad-sig event

```bash
npm test -- --testPathPattern=webhook-replay
```

---

## Request / Response Reference

| Scenario | HTTP Status | Body |
|----------|-------------|------|
| Invalid signature | `401` | `{ "error": "Invalid signature" }` |
| Stale / invalid timestamp | `400` | `{ "error": "Webhook rejected: stale or invalid timestamp" }` |
| Missing event ID | `400` | `{ "error": "Missing event ID" }` |
| Duplicate (already processed) | `200` | `{ "received": true, "duplicate": true }` |
| Successfully processed | `200` | `{ "received": true }` |
| Internal error | `500` | `{ "error": "Internal server error" }` |

---

## Security Contact

To report a vulnerability: **security@stellar.app**
