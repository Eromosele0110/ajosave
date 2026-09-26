/**
 * Cursor-based pagination utilities.
 *
 * Cursor pagination scales better than offset pagination for large datasets:
 * - No page drift when new records are inserted between requests
 * - O(log N) seeks using an indexed cursor field instead of OFFSET scans
 * - Predictable performance regardless of how deep into a list you paginate
 *
 * Cursors are base64url-encoded opaque tokens that encode the last seen
 * value of the sort field (e.g., `created_at` or `id`).
 *
 * Usage:
 *   const params = parseCursorParams(req.nextUrl.searchParams);
 *   const { sql, values } = buildCursorQuery("circles", "id", params, filters);
 *   const rows = await query(sql, values);
 *   const result = buildCursorResult(rows, params.limit, (row) => row.id);
 */

// ─── Encoding ────────────────────────────────────────────────────────────────

/**
 * Encode a plain string value into a base64url cursor token.
 *
 * @param value - The raw cursor value (e.g., an ID string or ISO timestamp)
 * @returns A base64url-encoded opaque string safe for use in URLs
 */
export function encodeCursor(value: string): string {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  // base64url: replace +/= with URL-safe chars
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decode a base64url cursor token back to the original plain value.
 *
 * @param cursor - A base64url-encoded cursor token
 * @returns The original plain string value
 * @throws {Error} If the cursor is not valid base64url
 */
export function decodeCursor(cursor: string): string {
  // Re-pad stripped base64 padding
  const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const b64 = remainder === 0 ? padded : padded + "=".repeat(4 - remainder);
  return Buffer.from(b64, "base64").toString("utf8");
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Parameters for a cursor-paginated request. */
export interface CursorPaginationParams {
  /** Decoded cursor value from the previous page response, or undefined for the first page. */
  cursor?: string;
  /** Maximum number of items to return per page. Callers should validate/cap this value. */
  limit: number;
}

/** Shape returned by cursor-paginated API endpoints. */
export interface CursorPaginationResult<T> {
  /** The records for this page. */
  items: T[];
  /** Encoded cursor to pass as `cursor` query param to fetch the next page, or null if no more pages. */
  nextCursor: string | null;
  /** True when there are more pages available. */
  hasMore: boolean;
  /** Optional total count of matching records (expensive — omit when not needed). */
  total?: number;
}

// ─── Query builder ───────────────────────────────────────────────────────────

/** A filter entry describing a single WHERE condition. */
export interface CursorFilter {
  /** Column name (must be a validated/allowlisted value — never pass raw user input). */
  column: string;
  /** SQL comparison operator. */
  operator: "=" | "!=" | "<" | "<=" | ">" | ">=" | "ILIKE" | "IN";
  /** Bound value (passed as a parameterized placeholder, never interpolated). */
  value: unknown;
}

/**
 * Build a parameterized SELECT statement for cursor-based pagination.
 *
 * The query fetches `limit + 1` rows so callers can detect whether a next
 * page exists without an extra COUNT query. Callers must slice the result
 * to `limit` rows before returning to clients.
 *
 * @param tableName  - The table to query (must be an allowlisted identifier)
 * @param cursorField - The column used for cursor ordering (must be indexed)
 * @param params      - Pagination parameters (cursor, limit)
 * @param filters     - Optional additional WHERE conditions
 * @returns An object with the SQL string and its bound parameter array
 *
 * @example
 * ```ts
 * const { sql, values } = buildCursorQuery("circles", "id", { limit: 20 }, [
 *   { column: "status", operator: "=", value: "open" },
 * ]);
 * const rows = await query(sql, values);
 * const result = buildCursorResult(rows, 20, (row) => row.id);
 * ```
 */
export function buildCursorQuery(
  tableName: string,
  cursorField: string,
  params: CursorPaginationParams,
  filters: CursorFilter[] = []
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];

  // Cursor condition: fetch rows strictly after the last seen cursor value
  if (params.cursor !== undefined) {
    values.push(params.cursor);
    conditions.push(`"${cursorField}" > $${values.length}`);
  }

  // Additional filters
  for (const filter of filters) {
    values.push(filter.value);
    const placeholder = `$${values.length}`;
    if (filter.operator === "IN") {
      conditions.push(`"${filter.column}" = ANY(${placeholder}::text[])`);
    } else {
      conditions.push(`"${filter.column}" ${filter.operator} ${placeholder}`);
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit+1 rows so we can determine hasMore without a COUNT query
  values.push(params.limit + 1);
  const limitPlaceholder = `$${values.length}`;

  const sql = [
    `SELECT * FROM "${tableName}"`,
    whereClause,
    `ORDER BY "${cursorField}" ASC`,
    `LIMIT ${limitPlaceholder}`,
  ]
    .filter(Boolean)
    .join(" ");

  return { sql, values };
}

// ─── Result builder ───────────────────────────────────────────────────────────

/**
 * Convert raw database rows into a `CursorPaginationResult`.
 *
 * Pass `limit + 1` rows from the DB; this function detects the extra row,
 * sets `hasMore`, slices back to `limit` items, and encodes the next cursor.
 *
 * @param rows         - Raw rows fetched from the DB (up to limit + 1)
 * @param limit        - The requested page size
 * @param getCursorValue - Function that extracts the cursor field value from a row
 * @param total        - Optional pre-computed total count
 */
export function buildCursorResult<T>(
  rows: T[],
  limit: number,
  getCursorValue: (row: T) => string,
  total?: number
): CursorPaginationResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem !== undefined ? encodeCursor(getCursorValue(lastItem)) : null;

  return {
    items,
    nextCursor,
    hasMore,
    ...(total !== undefined ? { total } : {}),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse and validate cursor pagination params from URL search params.
 * Caps limit to 100 to prevent abuse.
 *
 * @param searchParams - URL search params from the request
 * @param defaultLimit - Default page size when `limit` is not specified (default: 20)
 * @param maxLimit     - Hard cap on page size (default: 100)
 */
export function parseCursorParams(
  searchParams: URLSearchParams,
  defaultLimit = 20,
  maxLimit = 100
): CursorPaginationParams {
  const rawCursor = searchParams.get("cursor");
  const rawLimit = searchParams.get("limit");

  let cursor: string | undefined;
  if (rawCursor) {
    try {
      cursor = decodeCursor(rawCursor);
    } catch {
      // Invalid cursor — treat as first page
      cursor = undefined;
    }
  }

  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : defaultLimit;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, maxLimit)
    : defaultLimit;

  return { cursor, limit };
}
