import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { runRetention, type RetentionResult } from "@/lib/retention";
import type { ApiResponse } from "@/types";

/** GET /api/v1/cron/retention[?dryRun=true] — purge data past its retention window. */
export const GET = async (req: NextRequest) => {
  const unauth = await verifyCronSecret(req);
  if (unauth) return unauth;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";
  const results = await runRetention({ dryRun });
  const failed = results.filter((r) => r.error).map((r) => r.table);
  if (failed.length) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: `Retention failed for: ${failed.join(", ")}` },
      { status: 500 }
    );
  }
  return NextResponse.json<ApiResponse<{ results: RetentionResult[] }>>({ success: true, data: { results } });
};
