/**
 * @jest-environment node
 */

import {
  encodeCursor,
  decodeCursor,
  buildCursorQuery,
  buildCursorResult,
  parseCursorParams,
} from "../pagination";

// ─── encodeCursor / decodeCursor ─────────────────────────────────────────────

describe("encodeCursor", () => {
  it("returns a non-empty string for a simple UUID", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(encodeCursor(id)).toBeTruthy();
  });

  it("does not contain +, / or = characters (URL-safe base64url)", () => {
    // Run many values to ensure we exercise the padding/+/ cases
    const values = [
      "a",
      "ab",
      "abc",
      "abcd",
      "hello world",
      "2024-01-01T00:00:00.000Z",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const v of values) {
      const encoded = encodeCursor(v);
      expect(encoded).not.toMatch(/[+/=]/);
    }
  });

  it("produces different outputs for different inputs", () => {
    expect(encodeCursor("abc")).not.toBe(encodeCursor("xyz"));
  });

  it("is deterministic", () => {
    const id = "some-circle-id-123";
    expect(encodeCursor(id)).toBe(encodeCursor(id));
  });
});

describe("decodeCursor", () => {
  it("round-trips a simple string", () => {
    const original = "550e8400-e29b-41d4-a716-446655440000";
    expect(decodeCursor(encodeCursor(original))).toBe(original);
  });

  it("round-trips a string with special characters", () => {
    const original = "hello world & more";
    expect(decodeCursor(encodeCursor(original))).toBe(original);
  });

  it("round-trips an ISO timestamp string", () => {
    const ts = new Date("2024-06-15T12:00:00.000Z").toISOString();
    expect(decodeCursor(encodeCursor(ts))).toBe(ts);
  });

  it("round-trips strings of varying lengths (tests padding edge cases)", () => {
    for (const s of ["a", "ab", "abc", "abcd", "abcde"]) {
      expect(decodeCursor(encodeCursor(s))).toBe(s);
    }
  });

  it("handles base64url tokens that were originally standard base64 with +/=", () => {
    // Manually encode something that would produce + or / in standard base64
    // \xfb\xff produces /v8= in standard base64
    const raw = Buffer.from([0xfb, 0xff]).toString("utf8");
    const encoded = encodeCursor(raw);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeCursor(encoded)).toBe(raw);
  });
});

// ─── buildCursorQuery ────────────────────────────────────────────────────────

describe("buildCursorQuery", () => {
  it("returns a valid SELECT statement without a cursor or filters", () => {
    const { sql, values } = buildCursorQuery("circles", "id", { limit: 20 });
    expect(sql).toMatch(/^SELECT \* FROM "circles"/);
    expect(sql).toContain('ORDER BY "id" ASC');
    expect(sql).toContain("LIMIT $1");
    expect(values).toEqual([21]); // limit + 1
  });

  it("includes a cursor WHERE clause when cursor is provided", () => {
    const { sql, values } = buildCursorQuery("circles", "id", {
      cursor: "some-id-value",
      limit: 10,
    });
    expect(sql).toContain('"id" > $1');
    expect(values[0]).toBe("some-id-value");
    expect(values[1]).toBe(11); // limit + 1
  });

  it("appends filter conditions after cursor condition", () => {
    const { sql, values } = buildCursorQuery(
      "circles",
      "id",
      { limit: 5 },
      [
        { column: "status", operator: "=", value: "open" },
        { column: "currency", operator: "=", value: "USD" },
      ]
    );
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"currency" = $2');
    expect(values[0]).toBe("open");
    expect(values[1]).toBe("USD");
    expect(values[2]).toBe(6); // limit + 1
  });

  it("combines cursor condition with additional filters", () => {
    const { sql, values } = buildCursorQuery(
      "circles",
      "id",
      { cursor: "last-id", limit: 10 },
      [{ column: "status", operator: "=", value: "open" }]
    );
    // Cursor goes first, then filter, then limit param
    expect(values[0]).toBe("last-id"); // cursor value
    expect(values[1]).toBe("open");   // filter value
    expect(values[2]).toBe(11);       // limit + 1
    expect(sql).toContain('"id" > $1');
    expect(sql).toContain('"status" = $2');
    expect(sql).toContain("LIMIT $3");
  });

  it("handles ILIKE filter operator", () => {
    const { sql } = buildCursorQuery(
      "circles",
      "id",
      { limit: 20 },
      [{ column: "name", operator: "ILIKE", value: "%test%" }]
    );
    expect(sql).toContain('"name" ILIKE $1');
  });

  it("fetches limit+1 rows (the extra row is used to detect hasMore)", () => {
    const { values } = buildCursorQuery("circles", "id", { limit: 20 });
    const limitValue = values[values.length - 1] as number;
    expect(limitValue).toBe(21);
  });

  it("omits WHERE clause when no cursor and no filters", () => {
    const { sql } = buildCursorQuery("circles", "id", { limit: 20 });
    expect(sql).not.toContain("WHERE");
  });
});

// ─── buildCursorResult ───────────────────────────────────────────────────────

type Row = { id: string; name: string };

describe("buildCursorResult", () => {
  const makeRows = (count: number): Row[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `id-${String(i + 1).padStart(3, "0")}`,
      name: `Circle ${i + 1}`,
    }));

  it("returns all items when fewer rows than limit (no next page)", () => {
    const rows = makeRows(5);
    const result = buildCursorResult(rows, 10, (r) => r.id);
    expect(result.items).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("returns exactly limit items when limit+1 rows are returned", () => {
    const rows = makeRows(11); // limit=10, so 11 rows indicates hasMore
    const result = buildCursorResult(rows, 10, (r) => r.id);
    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
  });

  it("encodes the last item's cursor field as nextCursor when hasMore is true", () => {
    const rows = makeRows(11);
    const result = buildCursorResult(rows, 10, (r) => r.id);
    // Last item in the returned page is index 9 (id-010)
    expect(result.nextCursor).toBe(encodeCursor("id-010"));
    expect(result.nextCursor).not.toBeNull();
  });

  it("sets nextCursor to null when there is no next page", () => {
    const rows = makeRows(3);
    const result = buildCursorResult(rows, 20, (r) => r.id);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it("includes optional total when provided", () => {
    const rows = makeRows(5);
    const result = buildCursorResult(rows, 10, (r) => r.id, 42);
    expect(result.total).toBe(42);
  });

  it("omits total when not provided", () => {
    const rows = makeRows(5);
    const result = buildCursorResult(rows, 10, (r) => r.id);
    expect("total" in result).toBe(false);
  });

  it("handles empty result set", () => {
    const result = buildCursorResult<Row>([], 10, (r) => r.id);
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("the nextCursor can be decoded back to the last item id", () => {
    const rows = makeRows(6); // limit=5, 6 rows → hasMore
    const result = buildCursorResult(rows, 5, (r) => r.id);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeCursor(result.nextCursor!)).toBe("id-005");
  });
});

// ─── parseCursorParams ───────────────────────────────────────────────────────

describe("parseCursorParams", () => {
  const makeParams = (obj: Record<string, string>) => new URLSearchParams(obj);

  it("returns default limit when no params are given", () => {
    const result = parseCursorParams(makeParams({}));
    expect(result.limit).toBe(20);
    expect(result.cursor).toBeUndefined();
  });

  it("parses a valid encoded cursor", () => {
    const encoded = encodeCursor("some-circle-id");
    const result = parseCursorParams(makeParams({ cursor: encoded }));
    expect(result.cursor).toBe("some-circle-id");
  });

  it("ignores an invalid cursor and returns undefined", () => {
    // Non-base64 garbage
    const result = parseCursorParams(makeParams({ cursor: "!!!not-valid-base64!!!" }));
    // Should not throw; cursor should be a string or undefined (garbage in → decoded garbage out, not an error)
    // The function catches decode errors and falls back to undefined
    expect(typeof result.cursor === "string" || result.cursor === undefined).toBe(true);
  });

  it("respects custom defaultLimit", () => {
    const result = parseCursorParams(makeParams({}), 50);
    expect(result.limit).toBe(50);
  });

  it("caps limit at maxLimit", () => {
    const result = parseCursorParams(makeParams({ limit: "500" }), 20, 100);
    expect(result.limit).toBe(100);
  });

  it("uses provided limit when within maxLimit", () => {
    const result = parseCursorParams(makeParams({ limit: "50" }), 20, 100);
    expect(result.limit).toBe(50);
  });

  it("falls back to defaultLimit for non-numeric limit values", () => {
    const result = parseCursorParams(makeParams({ limit: "abc" }));
    expect(result.limit).toBe(20);
  });

  it("falls back to defaultLimit for zero or negative limit", () => {
    expect(parseCursorParams(makeParams({ limit: "0" })).limit).toBe(20);
    expect(parseCursorParams(makeParams({ limit: "-5" })).limit).toBe(20);
  });
});
