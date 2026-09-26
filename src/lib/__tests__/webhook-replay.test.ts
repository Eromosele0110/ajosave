/**
 * @jest-environment node
 */

import { createHmac } from "crypto";
import {
  verifyPaystackSignature,
  validateWebhookTimestamp,
  extractEventId,
  DEFAULT_MAX_AGE_MS,
  WebhookValidationResult,
} from "../webhook-replay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignature(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// verifyPaystackSignature
// ---------------------------------------------------------------------------

describe("verifyPaystackSignature", () => {
  const SECRET = "sk_test_supersecretkey";
  const BODY = JSON.stringify({ event: "charge.success", id: 1 });
  const VALID_SIG = makeSignature(BODY, SECRET);

  it("returns valid:true for a correct signature", () => {
    const result = verifyPaystackSignature(BODY, VALID_SIG, SECRET);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid:false for a tampered body", () => {
    const tamperedBody = BODY.replace("charge.success", "charge.failed");
    const result = verifyPaystackSignature(tamperedBody, VALID_SIG, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it("returns valid:false for a wrong signature", () => {
    const wrongSig = makeSignature(BODY, "wrong-secret");
    const result = verifyPaystackSignature(BODY, wrongSig, SECRET);
    expect(result.valid).toBe(false);
  });

  it("returns valid:false when signature is empty string", () => {
    const result = verifyPaystackSignature(BODY, "", SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing signature/i);
  });

  it("returns valid:false when secret key is empty", () => {
    const result = verifyPaystackSignature(BODY, VALID_SIG, "");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing secret key/i);
  });

  it("returns valid:false when rawBody is empty", () => {
    const result = verifyPaystackSignature("", VALID_SIG, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/empty request body/i);
  });

  it("returns valid:false for signature of different length (prevents trivial bypass)", () => {
    const shortSig = VALID_SIG.slice(0, 10);
    const result = verifyPaystackSignature(BODY, shortSig, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/length mismatch/i);
  });

  it("is case-sensitive for the signature hex", () => {
    // HMAC output is lowercase hex; upper-casing should fail
    const upperSig = VALID_SIG.toUpperCase();
    const result = verifyPaystackSignature(BODY, upperSig, SECRET);
    expect(result.valid).toBe(false);
  });

  it("handles Unicode bodies correctly", () => {
    const unicodeBody = JSON.stringify({ event: "charge.success", name: "Àbíọ́dún" });
    const sig = makeSignature(unicodeBody, SECRET);
    expect(verifyPaystackSignature(unicodeBody, sig, SECRET).valid).toBe(true);
  });

  it("handles large payloads without error", () => {
    const largeBody = JSON.stringify({ data: "x".repeat(100_000) });
    const sig = makeSignature(largeBody, SECRET);
    expect(verifyPaystackSignature(largeBody, sig, SECRET).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateWebhookTimestamp
// ---------------------------------------------------------------------------

describe("validateWebhookTimestamp", () => {
  it("accepts an ISO 8601 timestamp that is just now", () => {
    const result = validateWebhookTimestamp(isoNow());
    expect(result.valid).toBe(true);
  });

  it("accepts a timestamp 4 minutes ago (within 5-minute window)", () => {
    const fourMinsAgo = isoNow(-4 * 60 * 1000);
    const result = validateWebhookTimestamp(fourMinsAgo);
    expect(result.valid).toBe(true);
  });

  it("rejects a timestamp exactly at the default 5-minute boundary (too old)", () => {
    // 5 minutes + 1 second ago
    const tooOld = isoNow(-(DEFAULT_MAX_AGE_MS + 1000));
    const result = validateWebhookTimestamp(tooOld);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too old/i);
  });

  it("rejects a timestamp 10 minutes ago", () => {
    const tenMinsAgo = isoNow(-10 * 60 * 1000);
    const result = validateWebhookTimestamp(tenMinsAgo);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too old/i);
  });

  it("accepts a custom maxAgeMs window", () => {
    const ninetySecsAgo = isoNow(-90 * 1000);
    // Default window is 5 min → would be accepted; verify with strict 60s window
    expect(validateWebhookTimestamp(ninetySecsAgo, 60_000).valid).toBe(false);
    expect(validateWebhookTimestamp(ninetySecsAgo, 120_000).valid).toBe(true);
  });

  it("accepts a Unix timestamp in seconds (< 1e12)", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = validateWebhookTimestamp(nowSeconds);
    expect(result.valid).toBe(true);
  });

  it("accepts a Unix timestamp in milliseconds (>= 1e12)", () => {
    const nowMs = Date.now();
    const result = validateWebhookTimestamp(nowMs);
    expect(result.valid).toBe(true);
  });

  it("rejects an old Unix timestamp in seconds", () => {
    const tenMinsAgoSeconds = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    const result = validateWebhookTimestamp(tenMinsAgoSeconds);
    expect(result.valid).toBe(false);
  });

  it("returns valid:false for undefined", () => {
    const result = validateWebhookTimestamp(undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it("returns valid:false for an invalid date string", () => {
    const result = validateWebhookTimestamp("not-a-date");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid/i);
  });

  it("accepts a timestamp slightly in the future (within 30s clock skew tolerance)", () => {
    const twentySecsAhead = isoNow(20_000);
    const result = validateWebhookTimestamp(twentySecsAhead);
    expect(result.valid).toBe(true);
  });

  it("rejects a timestamp far in the future (beyond clock skew tolerance)", () => {
    const fiveMinutesAhead = isoNow(5 * 60 * 1000);
    const result = validateWebhookTimestamp(fiveMinutesAhead);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/future/i);
  });
});

// ---------------------------------------------------------------------------
// extractEventId
// ---------------------------------------------------------------------------

describe("extractEventId", () => {
  it("extracts the top-level id as a string", () => {
    const event = { id: 12345, event: "charge.success" };
    expect(extractEventId(event)).toBe("12345");
  });

  it("extracts a string id at the top level", () => {
    const event = { id: "evt_abc123", event: "charge.success" };
    expect(extractEventId(event)).toBe("evt_abc123");
  });

  it("falls back to data.id when top-level id is absent", () => {
    const event = { event: "charge.success", data: { id: 9999, reference: "ref_xyz" } };
    expect(extractEventId(event)).toBe("9999");
  });

  it("falls back to ref:<reference> when both ids are absent", () => {
    const event = { event: "charge.success", data: { reference: "ajo-ref-001" } };
    expect(extractEventId(event)).toBe("ref:ajo-ref-001");
  });

  it("falls back to SHA-256 hash when no id or reference", () => {
    const event = { event: "transfer.success", data: { amount: 500 } };
    const id = extractEventId(event);
    // Should be a 64-char hex string (SHA-256)
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for identical payloads (deterministic)", () => {
    const event = { event: "transfer.success", data: { amount: 500 } };
    expect(extractEventId(event)).toBe(extractEventId({ ...event }));
  });

  it("returns different hashes for different payloads", () => {
    const e1 = { event: "transfer.success", data: { amount: 500 } };
    const e2 = { event: "transfer.success", data: { amount: 600 } };
    expect(extractEventId(e1)).not.toBe(extractEventId(e2));
  });

  it("returns null for null input", () => {
    expect(extractEventId(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it("ignores empty string id and moves to next fallback", () => {
    const event = { id: "", data: { id: 42 } };
    expect(extractEventId(event)).toBe("42");
  });

  it("ignores null id and moves to next fallback", () => {
    const event = { id: null, data: { reference: "ref-007" } };
    expect(extractEventId(event as unknown as Record<string, unknown>)).toBe("ref:ref-007");
  });

  it("handles numeric 0 id (falsy but valid)", () => {
    // 0 is a technically valid id even if unusual; our check uses !== undefined/null/""
    // so 0 should be treated as present and returned as "0"
    const event = { id: 0 };
    expect(extractEventId(event)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Integration: all three utilities together
// ---------------------------------------------------------------------------

describe("replay protection integration", () => {
  const SECRET = "sk_live_integration_secret";

  it("accepts a fresh, correctly-signed event", () => {
    const event = {
      id: 99001,
      event: "charge.success",
      created_at: isoNow(-30_000), // 30 seconds ago
      data: { reference: "ref-fresh" },
    };
    const body = JSON.stringify(event);
    const sig = makeSignature(body, SECRET);

    const sigResult = verifyPaystackSignature(body, sig, SECRET);
    expect(sigResult.valid).toBe(true);

    const tsResult = validateWebhookTimestamp(event.created_at);
    expect(tsResult.valid).toBe(true);

    const id = extractEventId(event);
    expect(id).toBe("99001");
  });

  it("rejects a stale replayed event even with a valid signature", () => {
    const event = {
      id: 99002,
      event: "charge.success",
      created_at: isoNow(-10 * 60 * 1000), // 10 minutes ago
      data: { reference: "ref-stale" },
    };
    const body = JSON.stringify(event);
    const sig = makeSignature(body, SECRET);

    const sigResult = verifyPaystackSignature(body, sig, SECRET);
    expect(sigResult.valid).toBe(true); // sig is valid

    const tsResult = validateWebhookTimestamp(event.created_at);
    expect(tsResult.valid).toBe(false); // but timestamp is stale
    expect(tsResult.reason).toMatch(/too old/i);
  });

  it("rejects a fresh event with an invalid signature", () => {
    const event = {
      id: 99003,
      event: "charge.success",
      created_at: isoNow(-10_000),
      data: { reference: "ref-badsig" },
    };
    const body = JSON.stringify(event);
    const badSig = makeSignature(body, "wrong-secret");

    const sigResult = verifyPaystackSignature(body, badSig, SECRET);
    expect(sigResult.valid).toBe(false);
  });
});
