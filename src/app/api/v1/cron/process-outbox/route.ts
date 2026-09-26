import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { processOutboxEvents } from "@/server/services/outbox-processor.service";
import logger from "@/lib/logger";
import type { ApiResponse } from "@/types";

/**
 * POST /api/v1/cron/process-outbox
 *
 * Trigger a single outbox processing cycle. Designed to be called by a
 * scheduler (e.g. Vercel Cron, GitHub Actions, external cron) every minute.
 *
 * Authentication is enforced via HMAC-SHA256 signed headers.
 * See src/lib/cron-auth.ts for signing instructions.
 */
export async function POST(req: NextRequest): Promise<
  NextResponse<
    ApiResponse<{ processed: number; succeeded: number; failed: number }>
  >
> {
  // Verify HMAC signature — returns a 401 response on failure, null on success.
  const authError = await verifyCronSecret(req);
  if (authError) return authError as NextResponse<any>;

  try {
    const result = await processOutboxEvents();

    logger.info(result, "[cron/process-outbox] Run complete");

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    logger.error({ error: message }, "[cron/process-outbox] Unexpected error");

    return NextResponse.json(
      { success: false, error: "Outbox processing failed" },
      { status: 500 }
    );
  }
}
