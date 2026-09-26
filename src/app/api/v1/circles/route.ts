import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createCircleSchema } from "@/types/schemas";
import { createCircle, listOpenCircles, getCirclesByUser } from "@/server/services/circle.service";
import { withErrorHandler, withRateLimit, withSanitizedBody } from "@/server/middleware";
import {
  parseCursorParams,
  buildCursorResult,
} from "@/lib/pagination";
import type { ApiResponse, Circle } from "@/types";
import type { CursorPaginationResult } from "@/lib/pagination";

interface PaginatedCircles {
  data: Circle[];
  total: number;
  page: number;
  limit: number;
}

interface CircleFilters {
  frequency?: Circle["cycleFrequency"];
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  status?: Circle["status"];
}

function filterCircles(circles: Circle[], filters: CircleFilters): Circle[] {
  const search = filters.search?.trim().toLowerCase();

  return circles
    .filter((circle) =>
      filters.frequency === undefined || circle.cycleFrequency === filters.frequency
    )
    .filter((circle) =>
      filters.minAmount === undefined || circle.contributionNgn >= filters.minAmount
    )
    .filter((circle) =>
      filters.maxAmount === undefined || circle.contributionNgn <= filters.maxAmount
    )
    .filter((circle) => filters.status === undefined || circle.status === filters.status)
    .filter((circle) => search === undefined || circle.name.toLowerCase().includes(search))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export const GET = withRateLimit(withErrorHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter");

  // ── filter=mine: return the authenticated user's circles (unchanged) ────────
  if (filter === "mine") {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const userId = (session.user as { id: string }).id;
    const circles = await getCirclesByUser(userId);
    return NextResponse.json<ApiResponse<Circle[]>>({ success: true, data: circles });
  }

  // ── Shared filter params ───────────────────────────────────────────────────
  const frequency = searchParams.get("frequency") as Circle["cycleFrequency"] | null;
  const minAmount = searchParams.get("minAmount")
    ? parseInt(searchParams.get("minAmount")!, 10)
    : undefined;
  const maxAmount = searchParams.get("maxAmount")
    ? parseInt(searchParams.get("maxAmount")!, 10)
    : undefined;
  const search = searchParams.get("search") ?? undefined;
  const status = searchParams.get("status") as Circle["status"] | null;

  const filters: CircleFilters = {
    frequency: frequency ?? undefined,
    minAmount,
    maxAmount,
    search,
    status: status ?? undefined,
  };
  const filteredCircles = filterCircles(await listOpenCircles(), filters);

  // ── Cursor-based pagination (the default listing strategy) ────────────────
  //
  // The cursor encodes the last-seen circle `id`. We fetch limit+1 rows from
  // the service to detect whether a next page exists without an extra COUNT
  // query, then build the paginated result using buildCursorResult().
  //
  // Response shape:
  //   { success: true, data: { items: Circle[], nextCursor: string|null, hasMore: boolean } }
  //
  // To page through results:
  //   GET /api/v1/circles?limit=20
  //   GET /api/v1/circles?limit=20&cursor=<nextCursor from previous response>
  if (!searchParams.has("page")) {
    const cursorParams = parseCursorParams(searchParams);
    const { cursor, limit } = cursorParams;

    // Apply cursor filtering: skip all circles up to and including the cursor.
    if (cursor !== undefined) {
      const cursorIndex = filteredCircles.findIndex((circle) => circle.id === cursor);
      if (cursorIndex === -1) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Invalid or expired cursor", code: "INVALID_CURSOR" },
          { status: 400 }
        );
      }
      filteredCircles.splice(0, cursorIndex + 1);
    }

    const result: CursorPaginationResult<Circle> = buildCursorResult(
      filteredCircles,
      limit,
      (circle) => circle.id
    );

    return NextResponse.json<ApiResponse<CursorPaginationResult<Circle>>>({
      success: true,
      data: result,
    });
  }

  // ── Legacy offset-based pagination (page / limit) ─────────────────────────
  //
  // Kept for full backward compatibility. Existing clients that pass `page`
  // and `limit` continue to work exactly as before.
  //
  // Response shape:
  //   { success: true, data: PaginatedCircles }
  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
  const offset = (page - 1) * limit;
  const result: PaginatedCircles = {
    data: filteredCircles.slice(offset, offset + limit),
    total: filteredCircles.length,
    page,
    limit,
  };
  return NextResponse.json<ApiResponse<PaginatedCircles>>({ success: true, data: result });
}));

export const POST = withRateLimit(
  withErrorHandler(
    withSanitizedBody(async (req: NextRequest) => {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      const body = await req.json();
      const parsed = createCircleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: parsed.error.errors[0].message },
          { status: 400 }
        );
      }

      const userId = (session.user as { id: string }).id;
      const circle = await createCircle(userId, parsed.data);
      return NextResponse.json<ApiResponse<Circle>>(
        { success: true, data: circle },
        { status: 201 }
      );
    })
  ),
  { limit: 10, windowMs: 60_000 }
);
