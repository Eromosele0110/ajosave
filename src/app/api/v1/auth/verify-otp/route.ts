import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import { verifyOtpSchema } from "@/types/schemas";
import { getRedis } from "@/lib/redis";
import { getLockoutStatus, recordFailure, resetLockout } from "@/lib/lockout";
import { otpMatches } from "@/lib/otp-code";
import { query } from "@/lib/db";
import type { ApiResponse } from "@/types";

interface VerifyOtpResponse {
  message: string;
  user?: {
    id: string;
    phone: string;
    displayName: string;
    role: string;
  };
  lockout?: {
    isLocked: boolean;
    attempts: number;
    remainingAttempts: number;
    lockoutExpiresAt?: number;
    lockoutRemainingSeconds?: number;
  };
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies an OTP and returns lockout status on failure.
 * 
 * Request body:
 * {
 *   "phone": "+234...",
 *   "otp": "123456"
 * }
 * 
 * Success Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "OTP verified successfully",
 *     "user": {
 *       "id": "user-uuid",
 *       "phone": "+234...",
 *       "displayName": "User Name",
 *       "role": "user"
 *     }
 *   }
 * }
 * 
 * Failure Response (401):
 * {
 *   "success": false,
 *   "error": "Invalid or expired OTP",
 *   "data": {
 *     "lockout": {
 *       "isLocked": false,
 *       "attempts": 3,
 *       "remainingAttempts": 2
 *     }
 *   }
 * }
 * 
 * Locked Response (423):
 * {
 *   "success": false,
 *   "error": "Account locked due to too many failed attempts",
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
  withErrorHandler(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const parsed = verifyOtpSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json<ApiResponse<VerifyOtpResponse>>(
        {
          success: false,
          error: parsed.error.errors[0].message,
        },
        { status: 400 }
      );
    }

    const { phone, otp } = parsed.data;

    // Check for account lockout
    const lockoutStatus = await getLockoutStatus(phone);
    if (lockoutStatus.isLocked) {
      return NextResponse.json<ApiResponse<VerifyOtpResponse>>(
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

    // Verify OTP from Redis
    const redis = await getRedis();
    const storedOtp = await redis.get(`otp:${phone}`);

    if (!otpMatches(storedOtp, otp)) {
      // Record failure and get updated status
      const updatedStatus = await recordFailure(phone);

      // If newly locked, return 423; otherwise 401
      const statusCode = updatedStatus.isLocked ? 423 : 401;
      const errorMessage = updatedStatus.isLocked
        ? "Account locked due to too many failed attempts. Please try again in 30 minutes."
        : "Invalid or expired OTP. Please try again.";

      return NextResponse.json<ApiResponse<VerifyOtpResponse>>(
        {
          success: false,
          error: errorMessage,
          data: {
            message: "OTP verification failed",
            lockout: updatedStatus,
          } as any,
        },
        { status: statusCode }
      );
    }

    // OTP is valid - reset failure tracking and delete OTP
    await resetLockout(phone);
    await redis.del(`otp:${phone}`);

    // Load or create user
    let user = await query<{ id: string; phone: string; display_name: string; role: string }>(
      "SELECT id, phone, display_name, role FROM users WHERE phone = $1",
      [phone]
    );

    if (user.rows.length === 0) {
      // Create user on first successful OTP verification
      const result = await query<{ id: string; phone: string; display_name: string; role: string }>(
        `INSERT INTO users (id, phone, display_name, role, reputation_score, created_at)
         VALUES (gen_random_uuid(), $1, 'Ajosave User', 'user', 0, NOW())
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING id, phone, display_name, role`,
        [phone]
      );
      user = result;
    }

    const userData = user.rows[0];

    return NextResponse.json<ApiResponse<VerifyOtpResponse>>(
      {
        success: true,
        data: {
          message: "OTP verified successfully",
          user: {
            id: userData.id,
            phone: userData.phone,
            displayName: userData.display_name,
            role: userData.role,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[verify-otp] Error:", error);
    return NextResponse.json<ApiResponse<VerifyOtpResponse>>(
      {
        success: false,
        error: "Failed to verify OTP",
      },
      { status: 500 }
    );
  }
  }),
  { limit: 5, windowMs: 60_000 }
);
