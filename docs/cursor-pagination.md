# Cursor Pagination

> **Issue #26** — Replace offset pagination with cursor-based pagination on the circles listing endpoint.

---

## Overview

The `/api/v1/circles` endpoint supports two pagination strategies:

| Strategy | Query params | Best for |
|----------|-------------|----------|
| **Cursor** (new) | `cursor`, `limit` | Infinite scroll, real-time feeds, large datasets |
| **Offset** (legacy) | `page`, `limit` | Classic paged UIs, backward compatibility |

Both strategies are supported simultaneously. The cursor strategy is activated when the `cursor` query parameter is present (including an empty first-page request that omits `cursor`).

---

## Why Cursor Pagination?

Offset pagination (`OFFSET N LIMIT M`) has two key problems at scale:

1. **Page drift** — if a new record is inserted between two requests, the second page may skip a record or duplicate one from the first page.
2. **Performance** — `OFFSET N` requires the database to scan and discard the first N rows on every request, degrading linearly with page depth.

Cursor pagination solves both by anchoring each request to the last seen record ID instead of a row count. The database can satisfy the query with a single indexed seek.

---

## API Reference

### GET `/api/v1/circles`

#### Cursor pagination (new)

```
GET /api/v1/circles?limit=20
GET /api/v1/circles?limit=20&cursor=<nextCursor>
```

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Items per page. Capped at `100`. |
| `cursor` | string | — | Opaque base64url token from the previous response's `nextCursor`. Omit on the first request. |

All existing filter parameters continue to work alongside cursor pagination:

| Parameter | Type | Description |
|-----------|------|-------------|
| `frequency` | `weekly` \| `biweekly` \| `monthly` | Filter by contribution frequency |
| `minAmount` | integer | Minimum contribution amount (NGN) |
| `maxAmount` | integer | Maximum contribution amount (NGN) |
| `currency` | string | Filter by currency |
| `search` | string | Full-text search on circle name |
| `status` | `open` \| `active` \| `completed` \| `cancelled` | Filter by circle status |

**Response shape**

```jsonc
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Lagos Savings Circle",
        "contributionNgn": 50000,
        // ...other Circle fields
      }
    ],
    "nextCursor": "NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAx",
    "hasMore": true
  }
}
```

When there are no more pages:

```jsonc
{
  "success": true,
  "data": {
    "items": [...],
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### Offset pagination (legacy — unchanged)

```
GET /api/v1/circles?page=1&limit=20
```

Response shape is unchanged:

```jsonc
{
  "success": true,
  "data": {
    "circles": [...],
    "total": 142,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

## Client Usage

### First page

```typescript
const response = await fetch("/api/v1/circles?limit=20");
const { data } = await response.json();

const { items, nextCursor, hasMore } = data;
```

### Subsequent pages

```typescript
async function fetchNextPage(cursor: string | null) {
  if (!cursor) return; // no more pages

  const url = `/api/v1/circles?limit=20&cursor=${encodeURIComponent(cursor)}`;
  const response = await fetch(url);
  const { data } = await response.json();
  return data; // { items, nextCursor, hasMore }
}
```

### Infinite scroll example

```typescript
let cursor: string | null = null;
let allCircles: Circle[] = [];

do {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/v1/circles?${params}`);
  const { data } = await res.json();

  allCircles = [...allCircles, ...data.items];
  cursor = data.nextCursor;
} while (cursor !== null);
```

---

## Cursor Format

Cursors are **opaque base64url tokens**. Clients must treat them as black boxes:

- Do not construct cursors manually.
- Do not attempt to decode or store cursor contents — the internal format may change.
- Cursors are only valid for the same filter parameters used when they were issued.

**Implementation detail** (internal): The cursor encodes the `id` of the last item on the current page. On the next request the API fetches records with an `id` greater than the decoded cursor value.

---

## Utility Library

Cursor pagination is implemented in `src/lib/pagination.ts`. The public API:

```typescript
import {
  encodeCursor,          // encode a plain string → base64url token
  decodeCursor,          // decode a base64url token → plain string
  buildCursorQuery,      // build a parameterized SQL WHERE + ORDER BY + LIMIT clause
  buildCursorResult,     // convert raw DB rows into CursorPaginationResult<T>
  parseCursorParams,     // parse & validate cursor + limit from URLSearchParams
} from "@/lib/pagination";

// Types
import type {
  CursorPaginationParams,  // { cursor?: string; limit: number }
  CursorPaginationResult,  // { items: T[]; nextCursor: string|null; hasMore: boolean; total?: number }
  CursorFilter,            // { column: string; operator: ...; value: unknown }
} from "@/lib/pagination";
```

### Adding cursor pagination to a new route

```typescript
import { parseCursorParams, buildCursorQuery, buildCursorResult } from "@/lib/pagination";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params = parseCursorParams(searchParams);

  const { sql, values } = buildCursorQuery(
    "circles",        // table name (allowlisted identifier — never user input)
    "id",             // indexed cursor field
    params,
    [
      { column: "status", operator: "=", value: "open" },
    ]
  );

  const { rows } = await query(sql, values);
  const result = buildCursorResult(rows, params.limit, (row) => row.id);

  return NextResponse.json({ success: true, data: result });
}
```

---

## Migration Notes

Offset pagination (`?page=N&limit=M`) remains fully supported. No breaking changes were introduced. Clients can migrate to cursor pagination at their own pace.

When the circle service is migrated from the current in-memory store to a PostgreSQL-backed implementation, the cursor route handler should be updated to use `buildCursorQuery` directly against the database for maximum efficiency (keyset pagination at the SQL level instead of client-side cursor filtering).
