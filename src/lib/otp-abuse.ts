/**
 * OTP send abuse controls (#109).
 *
 * Every OTP costs an SMS, so an unauthenticated "send code" endpoint is a target for SMS
 * pumping (running up the bill, often to premium-rate numbers) and for harassing a victim's
 * phone. On top of the existing per-route rate limit and the verify-side lockout, each send
 * must clear three limits, all kept in Redis:
 *
 *  1. Resend cooldown — one OTP per phone every {@link OTP_RESEND_COOLDOWN_SECONDS}.
 *  2. Daily cap       — at most {@link OTP_MAX_SENDS_PER_PHONE_PER_DAY} OTPs per phone per 24h.
 *  3. Per-IP cap      — at most {@link OTP_MAX_SENDS_PER_IP_PER_HOUR} OTPs per client IP per hour.
 *
 * A failed SMS delivery releases the cooldown so the user can retry straight away.
 * Redis errors propagate (fail closed) rather than letting sends through unmetered.
 */
import { getRedis } from "./redis";
import logger from "./logger";

export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_PHONE_PER_DAY = 10;
export const OTP_MAX_SENDS_PER_IP_PER_HOUR = 20;

const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;

export type OtpSendDenialReason = "cooldown" | "phone-daily-limit" | "ip-hourly-limit";

export type OtpSendDecision =
  | { allowed: true }
  | { allowed: false; reason: OtpSendDenialReason; retryAfterSeconds: number; message: string };

const cooldownKey = (phone: string) => `otp_cooldown:${phone}`;
const dailyKey = (phone: string) => `otp_daily:${phone}`;
const ipKey = (ip: string) => `otp_ip:${ip}`;

/** `+2348012345678` → `+234*******678`, so logs never carry a full number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return "***";
  return `${phone.slice(0, 4)}${"*".repeat(phone.length - 7)}${phone.slice(-3)}`;
}

/** Best-effort client IP from proxy headers; `unknown` when none is present. */
export function getClientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

function retryAfter(ttl: number, fallback: number): number {
  return ttl > 0 ? ttl : fallback;
}

/** Increment a fixed-window counter, setting its expiry on first use. */
async function bump(
  redis: Awaited<ReturnType<typeof getRedis>>,
  key: string,
  windowSeconds: number
): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count;
}

/**
 * Decide whether an OTP may be sent to `phone` from `ip`, recording the attempt. Call once per
 * send; on `allowed: true` the resend cooldown is already armed.
 */
export async function checkOtpSendAllowed(phone: string, ip: string): Promise<OtpSendDecision> {
  const redis = await getRedis();

  // 1. Resend cooldown — atomically claim it; a second request inside the window loses.
  const claimed = await redis.set(cooldownKey(phone), "1", {
    NX: true,
    EX: OTP_RESEND_COOLDOWN_SECONDS,
  });
  if (!claimed) {
    const wait = retryAfter(await redis.ttl(cooldownKey(phone)), OTP_RESEND_COOLDOWN_SECONDS);
    logger.warn({ phone: maskPhone(phone), reason: "cooldown" }, "[otp] send denied");
    return {
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: wait,
      message: `Please wait ${wait} seconds before requesting another code.`,
    };
  }

  // 2. Daily cap per phone number.
  const perPhone = await bump(redis, dailyKey(phone), DAY_SECONDS);
  if (perPhone > OTP_MAX_SENDS_PER_PHONE_PER_DAY) {
    const wait = retryAfter(await redis.ttl(dailyKey(phone)), DAY_SECONDS);
    logger.warn({ phone: maskPhone(phone), reason: "phone-daily-limit" }, "[otp] send denied");
    return {
      allowed: false,
      reason: "phone-daily-limit",
      retryAfterSeconds: wait,
      message: "Too many codes requested for this number today. Please try again tomorrow.",
    };
  }

  // 3. Per-IP cap. Skipped when the IP is unknown: a shared "unknown" bucket would let one
  // unattributable client lock everyone else out.
  if (ip && ip !== "unknown") {
    const perIp = await bump(redis, ipKey(ip), HOUR_SECONDS);
    if (perIp > OTP_MAX_SENDS_PER_IP_PER_HOUR) {
      const wait = retryAfter(await redis.ttl(ipKey(ip)), HOUR_SECONDS);
      logger.warn({ ip, reason: "ip-hourly-limit" }, "[otp] send denied");
      return {
        allowed: false,
        reason: "ip-hourly-limit",
        retryAfterSeconds: wait,
        message: "Too many codes requested from this network. Please try again later.",
      };
    }
  }

  return { allowed: true };
}

/** Release the resend cooldown, e.g. after the SMS provider failed to deliver the code. */
export async function releaseOtpSendCooldown(phone: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(cooldownKey(phone));
}
