import { NextRequest, NextResponse } from "next/server";
import { sendOtp } from "@/lib/sms";
import { withRateLimit, withErrorHandler, withSanitizedBody } from "@/server/middleware";
import { sendOtpSchema } from "@/types/schemas";
import type { ApiResponse } from "@/types";
import { getRedis } from "@/lib/redis";
import { getLockoutStatus } from "@/lib/lockout";
import { checkOtpSendAllowed, getClientIp, releaseOtpSendCooldown } from "@/lib/otp-abuse";

interface SendOtpResponse {
  message: string;
  lockout?: {
    isLocked: boolean;
    attempts: number;
    remainingAttempts: number;
    lockoutExpiresAt?: number;
    lockoutRemainingSeconds?: number;
  };
}

/**
 * POST /api/auth/send-otp
 * Sends an OTP to a phone number with brute-force protection.
 * 
 * Acceptance Criteria:
 * ✅ Max 5 OTP attempts per phone number per 10 minutes
 * ✅ Account locked for 30 minutes after 5 failures
 * ✅ Lockout status returned in API response
 * ✅ Attempts tracked in Redis
 * 
 * Request body:
 * {
 *   "phone": "+234..."
 * }
 * 
 * Success Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "OTP sent successfully"
 *   }
 * }
 * 
 * Locked Response (423):
 * {
 *   "success": false,
 *   "error": "Account locked due to too many failed attempts. Please try again in 30 minutes.",
 *   "data": {
 *     "lockout": {
 *       "isLocked": true,
 *       "attempts": 5,
 *       "remainingAttempts": 0,
 *       "lockoutExpiresAt": 1234567890,
 *       "lockoutRemainingSeconds": 1800
 *     }
 *   }
 * }
 */
export const POST = withRateLimit(
  withErrorHandler(
    withSanitizedBody(async (req: NextRequest) => {
    const body = await req.json();
    const parsed = sendOtpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { phone } = parsed.data;

    // Check for account lockout (brute-force protection)
    const lockoutStatus = await getLockoutStatus(phone);
    if (lockoutStatus.isLocked) {
      return NextResponse.json<ApiResponse<SendOtpResponse>>(
        {
          success: false,
          error: "Account locked due to too many failed attempts. Please try again in 30 minutes.",
          data: {
            message: "Account is locked",
            lockout: lockoutStatus,
          } as any,
        },
        { status: 423 }
      );
    }

    const sendDecision = await checkOtpSendAllowed(phone, getClientIp(req.headers));
    if (!sendDecision.allowed) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: sendDecision.message },
        { status: 429, headers: { "Retry-After": String(sendDecision.retryAfterSeconds) } }
      );
    }

    let otp: string;
    try {
      otp = await sendOtp(phone);
    } catch (err) {
      // The code never reached the user: free the cooldown so they can retry at once.
      await releaseOtpSendCooldown(phone);
      throw err;
    }

    // Store OTP in Redis with 10-minute expiry
    const redis = await getRedis();
    await redis.set(`otp:${phone}`, otp, { EX: 600 });

    if (process.env.NODE_ENV === "development") console.warn(`[DEV] OTP for ${phone}: ${otp}`);

    return NextResponse.json<ApiResponse<SendOtpResponse>>({
      success: true,
      data: { message: "OTP sent successfully" },
    });
  })),
  { limit: 5, windowMs: 10 * 60 * 1000 }
);
