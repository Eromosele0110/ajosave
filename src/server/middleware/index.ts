import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as Sentry from "@sentry/nextjs";
import type { ApiError } from "@/types";
import { getRedis } from "@/lib/redis";
import { randomUUID } from "crypto";
import logger from "@/lib/logger";
import { runWithCorrelationId } from "@/lib/correlation";
import { sanitizeBody } from "@/lib/sanitize";
import { isAppError, internalError } from "@/lib/errors";

type Handler = (_req: NextRequest, _ctx?: any) => Promise<NextResponse>;

export function withAuth(handler: Handler): Handler {
  return async (req, ctx) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    return handler(req, ctx);
  };
}

export function withAdminAuth(handler: Handler): Handler {
  return async (req, ctx) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "admin") {
      return NextResponse.json<ApiError>(
        { success: false, error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      );
    }
    return handler(req, ctx);
  };
}

export function withErrorHandler(handler: Handler): Handler {
  return async (req, ctx) => {
    const correlationId =
      req.headers.get("x-correlation-id") ??
      req.headers.get("x-request-id") ??
      randomUUID();
    const { pathname } = new URL(req.url);
    const start = Date.now();

    return runWithCorrelationId(correlationId, async () => {
      const reqLogger = logger.child({ correlationId });
      try {
        const response = await handler(req, ctx);
        reqLogger.info({
          method: req.method,
          path: pathname,
          statusCode: response.status,
          durationMs: Date.now() - start,
        });
        response.headers.set("x-correlation-id", correlationId);
        return response;
      } catch (err) {
        const durationMs = Date.now() - start;

        // Resolve to AppError — known operational errors skip Sentry capture
        const appErr = isAppError(err) ? err : internalError();

        if (!isAppError(err)) {
          // Only capture truly unexpected errors in Sentry
          Sentry.captureException(err, {
            extra: { url: req.url, method: req.method, correlationId },
          });
        }

        reqLogger.error({
          method: req.method,
          path: pathname,
          statusCode: appErr.statusCode,
          durationMs,
          err,
        });

        const body: ApiError & { details?: unknown } = appErr.toJSON();
        const res = NextResponse.json<ApiError>(body, { status: appErr.statusCode });
        res.headers.set("x-correlation-id", correlationId);
        return res;
      }
    });
  };
}

/**
 * Redis sliding-window rate limiter.
 * Returns { allowed, remaining, resetAt } so callers can set X-RateLimit-* headers.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const redis = await getRedis();
  const now = Date.now();
  const windowStart = now - windowMs;
  const redisKey = `rl:${key}`;

  // Sliding window: remove old entries, add current timestamp, count
  await redis.zRemRangeByScore(redisKey, 0, windowStart);
  const count = await redis.zCard(redisKey);

  if (count >= limit) {
    const oldest = await redis.zRange(redisKey, 0, 0, { BY: "SCORE" });
    const resetAt = oldest[0] ? parseInt(oldest[0]) + windowMs : now + windowMs;
    return { allowed: false, remaining: 0, resetAt };
  }

  await redis.zAdd(redisKey, { score: now, value: String(now) });
  await redis.pExpire(redisKey, windowMs);
  return { allowed: true, remaining: limit - count - 1, resetAt: now + windowMs };
}

/**
 * Middleware wrapper that enforces rate limiting and sets X-RateLimit-* headers.
 */
export function withRateLimit(
  handler: Handler,
  { limit = 60, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {}
): Handler {
  return async (req, ctx) => {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const routeKey = new URL(req.url).pathname;
    const result = await rateLimit(`${routeKey}:${ip}`, limit, windowMs);

    if (!result.allowed) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Too many requests", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const response = await handler(req, ctx);
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return response;
  };
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Idempotency middleware for payment endpoints.
 * Reads X-Idempotency-Key header, returns cached response for duplicate keys.
 * Caches the response body + status in Redis for 24h.
 */
export function withIdempotency(handler: Handler): Handler {
  return async (req, ctx) => {
    const key = req.headers.get("x-idempotency-key");
    if (!key) return handler(req, ctx);

    const redis = await getRedis();
    const redisKey = `idempotency:${key}`;

    const cached = await redis.get(redisKey);
    if (cached) {
      const { status, body } = JSON.parse(cached);
      return NextResponse.json(body, { status });
    }

    const response = await handler(req, ctx);
    const body = await response.clone().json();
    await redis.set(redisKey, JSON.stringify({ status: response.status, body }), {
      EX: IDEMPOTENCY_TTL_SECONDS,
    });

    return response;
  };
}
