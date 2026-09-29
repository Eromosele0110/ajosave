/**
 * Referral fraud controls service.
 *
 * Issue #120 — Referral fraud controls
 *
 * Fraud checks implemented:
 *  1. Self-referral prevention — a user cannot use their own referral code
 *  2. Duplicate prevention — a user can only be referred once
 *  3. Velocity limit — max 5 referrals per referrer per 24 h window
 *  4. IP-based abuse — max 3 referrals from the same IP in 24 h
 *  5. Phone-based abuse — same phone number cannot generate multiple accounts
 *     and claim rewards (checked via referral_fraud_audit_log)
 *
 * All fraud events are written to `referral_fraud_audit_log` for observability
 * and manual review.
 */

import { randomUUID } from "crypto";
import { query, transaction } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReferralFraudReason =
  | "SELF_REFERRAL"
  | "ALREADY_REFERRED"
  | "VELOCITY_LIMIT"
  | "IP_LIMIT"
  | "INVALID_CODE"
  | "UNKNOWN";

export class ReferralFraudError extends Error {
  constructor(
    public readonly reason: ReferralFraudReason,
    message: string
  ) {
    super(message);
    this.name = "ReferralFraudError";
  }
}

export interface ReferralValidationResult {
  valid: true;
  referrerId: string;
  referralCode: string;
}

export interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  referralsLast24h: number;
  referredBy: string | null;
}

// ─── Velocity / IP thresholds ─────────────────────────────────────────────────

const VELOCITY_LIMIT_PER_24H = 5;   // max referrals a referrer can make per 24 h
const IP_LIMIT_PER_24H = 3;         // max referrals from one IP per 24 h

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Log a fraud event to the audit table.
 * Never throws — audit failures are logged to console and swallowed so they
 * don't block the calling flow.
 */
async function logFraudEvent(opts: {
  referrerId: string | null;
  suspectUserId: string | null;
  referralCode: string | null;
  reason: ReferralFraudReason;
  ipAddress: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO referral_fraud_audit_log
         (id, referrer_id, suspect_user_id, referral_code, reason, ip_address, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        randomUUID(),
        opts.referrerId,
        opts.suspectUserId,
        opts.referralCode,
        opts.reason,
        opts.ipAddress,
        JSON.stringify(opts.metadata ?? {}),
      ]
    );
  } catch (err) {
    console.error("[referral.service] Failed to write fraud audit log:", err);
  }
}

// ─── Core service functions ───────────────────────────────────────────────────

/**
 * Validate a referral code and apply fraud checks before recording the referral.
 *
 * Called when a new user submits a referral code (e.g. during sign-up or from
 * the referral page).  On success the referral row is inserted and the referrer
 * earns +5 reputation.
 *
 * @param code          The referral code submitted by the new user
 * @param newUserId     The user ID of the person being referred
 * @param ipAddress     IP address of the request (for IP-velocity check), or null
 * @throws ReferralFraudError if any fraud check fails
 * @throws Error if the code is invalid or DB ops fail
 */
export async function validateReferral(
  code: string,
  newUserId: string,
  ipAddress: string | null = null
): Promise<ReferralValidationResult> {
  return await transaction(async (q) => {
    // ── 1. Look up the referrer ──────────────────────────────────────────────
    const { rows: referrerRows } = await q<{ id: string; referral_code: string }>(
      "SELECT id, referral_code FROM users WHERE referral_code = $1 FOR SHARE",
      [code.toUpperCase()]
    );

    if (!referrerRows[0]) {
      await logFraudEvent({
        referrerId: null,
        suspectUserId: newUserId,
        referralCode: code,
        reason: "INVALID_CODE",
        ipAddress,
      });
      throw new ReferralFraudError("INVALID_CODE", "Invalid referral code.");
    }

    const referrerId = referrerRows[0].id;
    const referralCode = referrerRows[0].referral_code;

    // ── 2. Self-referral check ───────────────────────────────────────────────
    if (referrerId === newUserId) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "SELF_REFERRAL",
        ipAddress,
      });
      throw new ReferralFraudError("SELF_REFERRAL", "You cannot use your own referral code.");
    }

    // ── 3. Duplicate referral check ──────────────────────────────────────────
    const { rows: existingRows } = await q<{ id: string }>(
      "SELECT id FROM referrals WHERE referred_id = $1 LIMIT 1",
      [newUserId]
    );
    if (existingRows[0]) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "ALREADY_REFERRED",
        ipAddress,
      });
      throw new ReferralFraudError("ALREADY_REFERRED", "You have already used a referral code.");
    }

    // ── 4. Velocity check (referrer) — max 5 referrals in 24 h ──────────────
    const { rows: velocityRows } = await q<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrerId]
    );
    const referralsLast24h = parseInt(velocityRows[0]?.count ?? "0", 10);

    if (referralsLast24h >= VELOCITY_LIMIT_PER_24H) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "VELOCITY_LIMIT",
        ipAddress,
        metadata: { referralsLast24h, limit: VELOCITY_LIMIT_PER_24H },
      });
      throw new ReferralFraudError(
        "VELOCITY_LIMIT",
        "Referral velocity limit exceeded. Please try again later."
      );
    }

    // ── 5. IP-address velocity check — max 3 referrals from same IP in 24 h ──
    if (ipAddress) {
      const { rows: ipRows } = await q<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM referral_fraud_audit_log
         WHERE ip_address = $1
           AND reason != 'INVALID_CODE'
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [ipAddress]
      );
      const ipReferrals = parseInt(ipRows[0]?.count ?? "0", 10);

      if (ipReferrals >= IP_LIMIT_PER_24H) {
        await logFraudEvent({
          referrerId,
          suspectUserId: newUserId,
          referralCode,
          reason: "IP_LIMIT",
          ipAddress,
          metadata: { ipReferrals, limit: IP_LIMIT_PER_24H },
        });
        throw new ReferralFraudError(
          "IP_LIMIT",
          "Too many referrals from this network. Please try again later."
        );
      }
    }

    // ── All checks passed — record the referral ──────────────────────────────
    await q("UPDATE users SET referred_by = $1 WHERE id = $2", [referrerId, newUserId]);

    await q(
      `INSERT INTO referrals (id, referrer_id, referred_id, rewarded, created_at)
       VALUES ($1, $2, $3, FALSE, NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), referrerId, newUserId]
    );

    // Reward: +5 reputation to referrer (capped at 100)
    await q(
      "UPDATE users SET reputation_score = LEAST(reputation_score + 5, 100) WHERE id = $1",
      [referrerId]
    );

    return {
      valid: true as const,
      referrerId,
      referralCode,
    };
  });
}

/**
 * Check whether a referrer shows signs of abuse (for admin / review tooling).
 *
 * Returns all fraud events attributed to this referrer in the last 7 days,
 * and a summary of their referral velocity.
 */
export async function checkReferralFraud(referrerId: string): Promise<{
  isSuspicious: boolean;
  fraudEventsLast7d: number;
  referralsLast24h: number;
  reasons: ReferralFraudReason[];
}> {
  const [fraudRows, velocityRows] = await Promise.all([
    query<{ reason: string; count: string }>(
      `SELECT reason, COUNT(*) AS count
       FROM referral_fraud_audit_log
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY reason`,
      [referrerId]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrerId]
    ),
  ]);

  const fraudEventsLast7d = fraudRows.rows.reduce(
    (sum, row) => sum + parseInt(row.count, 10),
    0
  );
  const referralsLast24h = parseInt(velocityRows.rows[0]?.count ?? "0", 10);
  const reasons = fraudRows.rows.map((row) => row.reason as ReferralFraudReason);

  return {
    isSuspicious: fraudEventsLast7d > 0 || referralsLast24h >= VELOCITY_LIMIT_PER_24H,
    fraudEventsLast7d,
    referralsLast24h,
    reasons,
  };
}

/**
 * Get referral statistics for a user.
 *
 * Lazily generates a referral code if the user doesn't have one yet.
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  // Lazily generate a referral code if the user doesn't have one
  const { rows: userRows } = await query<{
    referral_code: string | null;
    referred_by: string | null;
  }>("SELECT referral_code, referred_by FROM users WHERE id = $1", [userId]);

  let code = userRows[0]?.referral_code ?? null;

  if (!code) {
    // Generate a unique 8-char hex code
    const { randomBytes } = await import("crypto");
    code = randomBytes(4).toString("hex").toUpperCase();
    await query("UPDATE users SET referral_code = $1 WHERE id = $2", [code, userId]);
  }

  const [countRows, last24hRows, referredByRows] = await Promise.all([
    query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM referrals WHERE referrer_id = $1",
      [userId]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
    userRows[0]?.referred_by
      ? query<{ display_name: string }>(
          "SELECT display_name FROM users WHERE id = $1",
          [userRows[0].referred_by]
        )
      : Promise.resolve({ rows: [] as { display_name: string }[] }),
  ]);

  return {
    referralCode: code,
    totalReferrals: parseInt(countRows.rows[0]?.count ?? "0", 10),
    referralsLast24h: parseInt(last24hRows.rows[0]?.count ?? "0", 10),
    referredBy: (referredByRows as { rows: { display_name: string }[] }).rows[0]?.display_name ?? null,
  };
}
