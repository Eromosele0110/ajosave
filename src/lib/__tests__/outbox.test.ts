/**
 * Unit tests for src/lib/outbox.ts
 *
 * The database is fully mocked so these tests run without a real Postgres
 * connection. Each test verifies the SQL text and parameters that the
 * outbox functions pass to the `query` helper.
 */

jest.mock("@/lib/db");

import {
  enqueueEvent,
  getPendingEvents,
  markEventProcessed,
  markEventFailed,
  requeueEvent,
  type OutboxEvent,
} from "@/lib/outbox";
import { query } from "@/lib/db";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: "evt-1",
    aggregate_type: "circle",
    aggregate_id: "circle-abc",
    event_type: "payout.processed",
    payload: { amount: "10.0000000" },
    status: "pending",
    attempts: 0,
    last_error: null,
    scheduled_at: new Date(),
    processed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// enqueueEvent
// ---------------------------------------------------------------------------

describe("enqueueEvent", () => {
  it("inserts a row using the default query function and returns the event", async () => {
    const event = makeEvent();
    mockQuery.mockResolvedValueOnce({ rows: [event], rowCount: 1 } as any);

    const result = await enqueueEvent(
      "circle",
      "circle-abc",
      "payout.processed",
      { amount: "10.0000000" }
    );

    expect(result).toEqual(event);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO outbox_events");
    expect(params).toEqual([
      "circle",
      "circle-abc",
      "payout.processed",
      JSON.stringify({ amount: "10.0000000" }),
    ]);
  });

  it("uses the provided transaction query function instead of the default", async () => {
    const event = makeEvent();
    const txQuery = jest.fn().mockResolvedValueOnce({ rows: [event], rowCount: 1 } as any);

    const result = await enqueueEvent(
      "user",
      "user-xyz",
      "user.registered",
      { phone: "+2341234567890" },
      txQuery as any
    );

    expect(result).toEqual(event);
    expect(txQuery).toHaveBeenCalledTimes(1);
    // Default query should NOT have been called
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("propagates errors from the query", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));

    await expect(
      enqueueEvent("circle", "c-1", "circle.created", {})
    ).rejects.toThrow("DB error");
  });
});

// ---------------------------------------------------------------------------
// getPendingEvents
// ---------------------------------------------------------------------------

describe("getPendingEvents", () => {
  it("returns rows with default limit of 100", async () => {
    const events = [makeEvent(), makeEvent({ id: "evt-2" })];
    mockQuery.mockResolvedValueOnce({ rows: events, rowCount: 2 } as any);

    const result = await getPendingEvents();

    expect(result).toEqual(events);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(params).toEqual([100]);
  });

  it("passes a custom limit to the query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await getPendingEvents(25);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([25]);
  });

  it("returns an empty array when no pending events exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getPendingEvents();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// markEventProcessed
// ---------------------------------------------------------------------------

describe("markEventProcessed", () => {
  it("updates status to delivered and sets processed_at", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await markEventProcessed("evt-1");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'delivered'");
    expect(sql).toContain("processed_at = NOW()");
    expect(params).toEqual(["evt-1"]);
  });
});

// ---------------------------------------------------------------------------
// markEventFailed
// ---------------------------------------------------------------------------

describe("markEventFailed", () => {
  it("increments attempts and stores last_error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await markEventFailed("evt-1", "Connection refused");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("attempts   = attempts + 1");
    expect(sql).toContain("last_error = $2");
    expect(params).toEqual(["evt-1", "Connection refused", 5]);
  });

  it("sets status to dead when maxAttempts is reached", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await markEventFailed("evt-1", "Timeout", 3);

    const [sql, params] = mockQuery.mock.calls[0];
    // The CASE expression transitions to 'dead' when attempts+1 >= maxAttempts
    expect(sql).toContain("'dead'");
    expect(params).toEqual(["evt-1", "Timeout", 3]);
  });

  it("accepts a custom maxAttempts override", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await markEventFailed("evt-2", "Bad gateway", 10);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// requeueEvent
// ---------------------------------------------------------------------------

describe("requeueEvent", () => {
  it("resets status to pending and pushes scheduled_at forward", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await requeueEvent("evt-1");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SET status       = 'pending'");
    expect(sql).toContain("scheduled_at = NOW()");
    // Default delay is 60 000 ms
    expect(params).toEqual(["evt-1", 60_000]);
  });

  it("uses a custom delay when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    await requeueEvent("evt-2", 120_000);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["evt-2", 120_000]);
  });
});
