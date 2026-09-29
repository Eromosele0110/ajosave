/**
 * OTP code helpers (#109): cryptographically secure generation and constant-time comparison.
 * Kept free of Redis/config imports so it is cheap to load anywhere.
 */
import { randomInt, timingSafeEqual } from "crypto";

export const OTP_LENGTH = 6;

/** A uniformly random OTP of {@link OTP_LENGTH} digits (never a leading zero). */
export function generateOtp(): string {
  return randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();
}

/**
 * Compare a submitted OTP with the stored one without leaking, through timing, how many
 * leading digits matched. A missing stored code never matches.
 */
export function otpMatches(stored: string | null | undefined, submitted: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(submitted, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
