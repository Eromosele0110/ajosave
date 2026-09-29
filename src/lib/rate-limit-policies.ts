/**
 * Route-specific rate limit policies (#36).
 * The first matching policy wins; DEFAULT_POLICY applies when nothing matches.
 */
export type RateLimitKeyBy = "ip" | "user";

export interface RateLimitPolicy {
  name: string;
  pattern: RegExp;
  methods?: string[];
  limit: number;
  windowMs: number;
  keyBy: RateLimitKeyBy;
  /** When the limiter backend is unavailable: allow (true) or reject (false). */
  failOpen: boolean;
}

export const DEFAULT_POLICY: RateLimitPolicy = {
  name: "default",
  pattern: /.*/,
  limit: 120,
  windowMs: 60_000,
  keyBy: "ip",
  failOpen: true,
};

export const RATE_LIMIT_POLICIES: RateLimitPolicy[] = [
  { name: "auth-otp", pattern: /^\/api(\/v1)?\/auth\/(send|verify)-otp$/, methods: ["POST"], limit: 5, windowMs: 15 * 60_000, keyBy: "ip", failOpen: false },
  { name: "auth", pattern: /^\/api(\/v1)?\/auth\//, methods: ["POST"], limit: 20, windowMs: 60_000, keyBy: "ip", failOpen: false },
  { name: "payments", pattern: /^\/api(\/v1)?\/circles\/[^/]+\/(contribute|payout|pay)/, methods: ["POST"], limit: 10, windowMs: 60_000, keyBy: "user", failOpen: false },
  { name: "exports", pattern: /\/export(s)?(\/|$)/, limit: 5, windowMs: 10 * 60_000, keyBy: "user", failOpen: false },
  { name: "admin", pattern: /^\/api(\/v1)?\/admin\//, limit: 60, windowMs: 60_000, keyBy: "user", failOpen: true },
  { name: "webhooks", pattern: /^\/api(\/v1)?\/webhooks\//, limit: 300, windowMs: 60_000, keyBy: "ip", failOpen: true },
];

export function resolveRateLimitPolicy(
  method: string,
  pathname: string,
  policies: RateLimitPolicy[] = RATE_LIMIT_POLICIES
): RateLimitPolicy {
  const m = method.toUpperCase();
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    policies.find((p) => p.pattern.test(path) && (!p.methods || p.methods.includes(m))) ??
    DEFAULT_POLICY
  );
}

/** Build the limiter bucket key; falls back to IP when a user-keyed policy has no user. */
export function rateLimitKey(policy: RateLimitPolicy, ip: string, userId?: string | null): string {
  const subject = policy.keyBy === "user" && userId ? `u:${userId}` : `ip:${ip || "unknown"}`;
  return `${policy.name}:${subject}`;
}
