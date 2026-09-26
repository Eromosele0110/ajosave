import { createHmac, timingSafeEqual, createHash } from "crypto";

export interface WebhookValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify Paystack webhook HMAC-SHA512 signature.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Paystack signs the raw request body with your secret key and places the
 * hex-encoded digest in the `x-paystack-signature` header.
 */
export function verifyPaystackSignature(
  rawBody: string,
  signature: string,
  secretKey: string
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, reason: "Missing signature header" };
  }
  if (!secretKey) {
    return { valid: false, reason: "Missing secret key" };
  }
  if (!rawBody) {
    return { valid: false, reason: "Empty request body" };
  }

  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  // Buffers must be the same byte length for timingSafeEqual
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== signatureBuffer.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }

  const match = timingSafeEqual(expectedBuffer, signatureBuffer);
  return match ? { valid: true } : { valid: false, reason: "Signature mismatch" };
}

/**
 * Default replay window: 5 minutes.
 * Paystack does not include a timestamp header, so we use the event's
 * `created_at` field from the payload body.
 */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate webhook timestamp to prevent replay attacks.
 * Rejects webhooks older than maxAgeMs (default 5 minutes).
 *
 * Paystack doesn't include a timestamp in the header, so we use
 * the event's created_at field from the payload.
 *
 * @param eventCreatedAt - ISO 8601 date string or Unix timestamp (seconds or ms)
 * @param maxAgeMs       - Maximum acceptable age in milliseconds (default: 5 minutes)
 */
export function validateWebhookTimestamp(
  eventCreatedAt: string | number | undefined,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): WebhookValidationResult {
  if (eventCreatedAt === undefined || eventCreatedAt === null) {
    return { valid: false, reason: "Missing created_at timestamp in event payload" };
  }

  let eventMs: number;

  if (typeof eventCreatedAt === "string") {
    const parsed = Date.parse(eventCreatedAt);
    if (Number.isNaN(parsed)) {
      return { valid: false, reason: "Invalid created_at timestamp format" };
    }
    eventMs = parsed;
  } else if (typeof eventCreatedAt === "number") {
    // Distinguish Unix seconds from milliseconds:
    // seconds timestamps are < 10^12, ms timestamps are >= 10^12
    eventMs = eventCreatedAt < 1e12 ? eventCreatedAt * 1000 : eventCreatedAt;
  } else {
    return { valid: false, reason: "Invalid created_at timestamp type" };
  }

  const nowMs = Date.now();
  const ageMs = nowMs - eventMs;

  if (ageMs < 0) {
    // Future-dated events are suspicious but we allow a small clock-skew tolerance
    const clockSkewToleranceMs = 30_000; // 30 seconds
    if (Math.abs(ageMs) > clockSkewToleranceMs) {
      return { valid: false, reason: "Event timestamp is too far in the future (possible clock skew)" };
    }
    return { valid: true };
  }

  if (ageMs > maxAgeMs) {
    return {
      valid: false,
      reason: `Event is too old: ${Math.round(ageMs / 1000)}s ago (max ${Math.round(maxAgeMs / 1000)}s)`,
    };
  }

  return { valid: true };
}

/**
 * Extract a unique event ID from a Paystack event payload.
 *
 * Paystack places a top-level `id` on the event envelope.  If that is absent
 * (e.g. bulk/test payloads) we fall back to a SHA-256 hash of the serialised
 * payload so that deduplication still works deterministically.
 *
 * Returns `null` only when the payload is completely empty/null.
 */
export function extractEventId(event: Record<string, unknown>): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  // Primary: top-level numeric or string id on the event envelope
  const topId = (event as Record<string, unknown>).id;
  if (topId !== undefined && topId !== null && topId !== "") {
    return String(topId);
  }

  // Secondary: data.id (some Paystack event shapes nest the id under data)
  const dataId = (event.data as Record<string, unknown> | undefined)?.id;
  if (dataId !== undefined && dataId !== null && dataId !== "") {
    return String(dataId);
  }

  // Tertiary: reference under data (always unique for charge events)
  const reference = (event.data as Record<string, unknown> | undefined)?.reference;
  if (reference !== undefined && reference !== null && reference !== "") {
    // Prefix to distinguish from a numeric id
    return `ref:${String(reference)}`;
  }

  // Fallback: deterministic hash of the full payload
  try {
    const payload = JSON.stringify(event);
    return createHash("sha256").update(payload).digest("hex");
  } catch {
    return null;
  }
}
