/**
 * POST /api/v1/referral/validate
 *
 * Apply a referral code for the authenticated user.
 * Runs all fraud checks (self-referral, duplicate, velocity, IP-velocity)
 * before recording the referral and rewarding the referrer.
 *
 * GET /api/v1/referral/validate
 *
 * Retrieve the current user's referral stats (code, counts, referred-by).
 *
 * Issue #120 — Referral fraud controls
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  validateReferral,
  getReferralStats,
  ReferralFraudError,
} from "@/server/services/referral.service";
import { withErrorHandler, withRateLimit, withSanitizedBody } from "@/server/middleware";
import type { ApiResponse } from "@/types";

/**
 * Extract client IP from Next.js request headers.
 * Respects X-Forwarded-For (set by Vercel / reverse proxies).
 */
function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

/** GET — return referral stats for the current user */
export const GET = withRateLimit(
  withErrorHandler(async (_req: NextRequest) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = (session.user as { id: string }).id;
    const stats = await getReferralStats(userId);

    return NextResponse.json<ApiResponse<typeof stats>>({ success: true, data: stats });
  }),
  { limit: 30, windowMs: 60_000 }
);

/** POST — apply a referral code with full fraud checks */
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

      const userId = (session.user as { id: string }).id;
      const ipAddress = getClientIp(req);

      const body = (await req.json()) as { code?: string };

      if (!body.code || typeof body.code !== "string") {
        return NextResponse.json<ApiResponse<never>>(
          { success: false, error: "Referral code is required" },
          { status: 400 }
        );
      }

      try {
        const result = await validateReferral(body.code.trim(), userId, ipAddress);
        return NextResponse.json<ApiResponse<typeof result>>(
          { success: true, data: result },
          { status: 201 }
        );
      } catch (err) {
        if (err instanceof ReferralFraudError) {
          // Map fraud reasons to informative but non-leaking error messages
          const statusMap: Record<string, number> = {
            SELF_REFERRAL: 400,
            ALREADY_REFERRED: 409,
            VELOCITY_LIMIT: 429,
            IP_LIMIT: 429,
            INVALID_CODE: 404,
          };
          const status = statusMap[err.reason] ?? 400;
          return NextResponse.json<ApiResponse<never>>(
            { success: false, error: err.message, code: err.reason },
            { status }
          );
        }
        throw err; // let withErrorHandler produce a 500
      }
    })
  ),
  { limit: 5, windowMs: 60_000 } // aggressive rate-limit on referral submission
);
