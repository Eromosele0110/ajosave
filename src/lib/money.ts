/**
 * Application-level mirror of the financial DB constraints (#27).
 * Validating before writes gives callers a clear 400 instead of a raw
 * Postgres constraint violation.
 */
import { badRequest } from "./errors";

/** numeric(20,7): 13 integer digits, 7 fractional digits. */
const USDC_PATTERN = /^\d{1,13}(\.\d{1,7})?$/;

export function assertValidUsdcAmount(value: unknown, field = "amount_usdc"): string {
  const str = typeof value === "number" ? String(value) : value;
  if (typeof str !== "string" || !USDC_PATTERN.test(str)) {
    throw badRequest(`${field} must be a non-negative decimal with at most 7 decimal places`, { field });
  }
  if (Number(str) <= 0) {
    throw badRequest(`${field} must be greater than zero`, { field });
  }
  return str;
}

export function assertValidPartialPayment(paid: number, due: number): void {
  if (!Number.isFinite(paid) || paid < 0) {
    throw badRequest("amount_paid_usdc must be non-negative");
  }
  if (paid > due) {
    throw badRequest("amount_paid_usdc cannot exceed amount_usdc");
  }
}
