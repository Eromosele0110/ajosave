import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, withErrorHandler } from "@/server/middleware";
import { getQueryStats, slowQueryThresholdMs } from "@/lib/query-metrics";
import { getPoolStats } from "@/lib/db";

/** GET /api/v1/admin/query-stats?limit=20 — top statements by total DB time (admin only). */
export const GET = withErrorHandler(
  withAdminAuth(async (req: NextRequest) => {
    const raw = Number(req.nextUrl.searchParams.get("limit") ?? 20);
    const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
    return NextResponse.json({
      success: true,
      data: { slowQueryMs: slowQueryThresholdMs(), pool: getPoolStats(), queries: getQueryStats(limit) },
    });
  })
);
