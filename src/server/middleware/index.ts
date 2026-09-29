import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as Sentry from "@sentry/nextjs";
import type { ApiError } from "@/types";
import { getRedis } from "@/lib/redis";
import { randomUUID, createHash } from "crypto";
import { getToken } from "next-auth/jwt";
import { isSessionRevoked, hashToken } from "@/lib/sessions";
import { resolveRateLimitPolicy, rateLimitKey } from "@/lib/rate-limit-policies";
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
const IDEMPOTENCY_LOCK_SECONDS = 60;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_\-:]{8,128}$/;

function idempotencyError(status: number, error: string, code: string) {
  return NextResponse.json<ApiError>({ success: false, error, code } as ApiError, { status });
}

/**
 * Mutation idempotency middleware (#40).
 * - Accepts `Idempotency-Key` (or legacy `X-Idempotency-Key`) on POST/PUT/PATCH/DELETE.
 * - Keys are scoped per method + path and bound to a SHA-256 fingerprint of the body:
 *   reusing a key with a different payload returns 422.
 * - A concurrent request with the same key returns 409 while the first is in flight.
 * - Only non-5xx responses are cached (24h) so transient failures can be retried.
 * - Replayed responses carry `Idempotent-Replayed: true`.
 */
export function withIdempotency(handler: Handler, { required = false }: { required?: boolean } = {}): Handler {
  return async (req, ctx) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return handler(req, ctx);

    const key = req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key");
    if (!key) {
      return required
        ? idempotencyError(400, "Idempotency-Key header is required", "IDEMPOTENCY_KEY_REQUIRED")
        : handler(req, ctx);
    }
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      return idempotencyError(400, "Invalid Idempotency-Key", "IDEMPOTENCY_KEY_INVALID");
    }

    const body = await req.clone().text().catch(() => "");
    const { pathname } = new URL(req.url);
    const fingerprint = createHash("sha256").update(`${req.method}\n${pathname}\n${body}`).digest("hex");
    const scope = createHash("sha256").update(`${req.method}:${pathname}:${key}`).digest("hex");
    const redisKey = `idempotency:${scope}`;
    const lockKey = `${redisKey}:lock`;

    const redis = await getRedis();
    const cached = await redis.get(redisKey);
    if (cached) {
      const stored = JSON.parse(cached) as { status: number; body: unknown; fingerprint?: string };
      if (stored.fingerprint && stored.fingerprint !== fingerprint) {
        return idempotencyError(422, "Idempotency-Key reused with a different request", "IDEMPOTENCY_KEY_MISMATCH");
      }
      const res = NextResponse.json(stored.body, { status: stored.status });
      res.headers.set("Idempotent-Replayed", "true");
      return res;
    }

    const locked = await redis.set(lockKey, fingerprint, { NX: true, EX: IDEMPOTENCY_LOCK_SECONDS });
    if (!locked) {
      return idempotencyError(409, "A request with this Idempotency-Key is in progress", "IDEMPOTENCY_IN_PROGRESS");
    }

    try {
      const response = await handler(req, ctx);
      if (response.status < 500) {
        const resBody = await response.clone().json().catch(() => null);
        await redis.set(
          redisKey,
          JSON.stringify({ status: response.status, body: resBody, fingerprint }),
          { EX: IDEMPOTENCY_TTL_SECONDS }
        );
      }
      return response;
    } finally {
      await redis.del(lockKey);
    }
  };
}

/**
 * Route-specific rate limiting (#36): picks the policy for the method + path from
 * RATE_LIMIT_POLICIES and enforces it, keyed by user or IP per policy.
 */
export function withRouteRateLimit(
  handler: Handler,
  { getUserId }: { getUserId?: (_req: NextRequest) => Promise<string | null> | string | null } = {}
): Handler {
  return async (req, ctx) => {
    const { pathname } = new URL(req.url);
    const policy = resolveRateLimitPolicy(req.method, pathname);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const userId = policy.keyBy === "user" && getUserId ? await getUserId(req) : null;

    let result: { allowed: boolean; remaining: number; resetAt: number };
    try {
      result = await rateLimit(rateLimitKey(policy, ip, userId), policy.limit, policy.windowMs);
    } catch (err) {
      logger.warn({ err, policy: policy.name }, "rate limiter unavailable");
      if (policy.failOpen) return handler(req, ctx);
      return NextResponse.json<ApiError>(
        { success: false, error: "Service temporarily unavailable", code: "RATE_LIMITER_UNAVAILABLE" } as ApiError,
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    const headers = {
      "X-RateLimit-Limit": String(policy.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      "X-RateLimit-Policy": policy.name,
    };
    if (!result.allowed) {
      logger.warn({ policy: policy.name, path: pathname }, "rate limit exceeded");
      return NextResponse.json<ApiError>(
        { success: false, error: "Too many requests", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) },
        }
      );
    }
    const response = await handler(req, ctx);
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };
}

/**
 * Rejects requests whose session has been revoked (#37). Requires a JWT carrying `sessionId`;
 * requests without one pass through to the regular auth checks.
 */
export function withSessionRevocationCheck(handler: Handler): Handler {
  return async (req, ctx) => {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
    const sessionId = token?.sessionId as string | undefined;
    if (sessionId && (await isSessionRevoked(hashToken(sessionId)))) {
      return NextResponse.json<ApiError>(
        { success: false, error: "Session has been revoked", code: "SESSION_REVOKED" } as ApiError,
        { status: 401 }
      );
    }
    return handler(req, ctx);
  };
}
