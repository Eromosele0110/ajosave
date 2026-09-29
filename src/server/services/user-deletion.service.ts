import { transaction } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { logAuditAction } from "./audit.service";
import { serverConfig } from "@/server/config";
import { getRedis } from "@/lib/redis";
import { revokeAllSessions } from "@/lib/sessions";

/**
 * Anonymizes all PII for a user while preserving financial records for audit.
 *
 * GDPR/NDPR compliance:
 * - Deletes: phone, email, display_name, stellar_public_key
 * - Preserves: contributions, payouts, circle membership (anonymized)
 * - Audit log entry created for the deletion
 * - Revokes every session (and denylists issued JWTs) so a stale token cannot keep acting
 *   for, or export data of, a deleted account
 * - Purges the phone-keyed OTP / lockout / send-limit state from Redis
 *
 * Exports are streamed on demand and never stored, so there are no export files to delete
 * (#110); see `docs/security-controls.md`.
 */
export async function deleteUserData(userId: string): Promise<{ email: string | null }> {
  const anonymizedName = `deleted-user-${userId.slice(0, 8)}`;

  const { email, phone } = await transaction(async (q) => {
    // Fetch email and phone before wiping them (email for the confirmation message,
    // phone to purge the Redis state keyed by it)
    const { rows } = await q<{ email: string | null; phone: string | null }>(
      "SELECT email, phone FROM users WHERE id = $1",
      [userId]
    );
    if (!rows[0]) throw new Error("User not found");
    const { email, phone } = rows[0];

    // Anonymize PII — preserve id, role, reputation_score, created_at for audit
    await q(
      `UPDATE users
       SET phone              = $1,
           display_name       = $2,
           email              = NULL,
           stellar_public_key = NULL,
           deleted_at         = NOW()
       WHERE id = $3`,
      [`deleted-${userId}`, anonymizedName, userId]
    );

    // Soft-delete active sessions by invalidating refresh tokens
    await q("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);

    return { email, phone: phone ?? null };
  });

  await purgeAuthResidue(userId, phone);

  // Audit log (outside transaction — non-critical)
  await logAuditAction(userId, "DELETE_USER", "USER", userId, {
    details: { reason: "GDPR/NDPR user-initiated deletion" },
  }).catch(() => {});

  return { email };
}

/** Redis keys that hold state for a phone number (see otp routes, lockout and otp-abuse). */
export function phoneKeyedRedisKeys(phone: string): string[] {
  return [
    `otp:${phone}`,
    `lockout:${phone}`,
    `otp_failures:${phone}`,
    `otp_cooldown:${phone}`,
    `otp_daily:${phone}`,
  ];
}

/**
 * Best-effort cleanup after the database has been anonymized. Failures are logged rather than
 * thrown: the PII is already gone and the deletion must not appear to fail because of a cache.
 */
async function purgeAuthResidue(userId: string, phone: string | null): Promise<void> {
  try {
    await revokeAllSessions(userId);
  } catch (err) {
    console.error("[user-deletion] Failed to revoke sessions:", err);
  }

  if (!phone || phone.startsWith("deleted-")) return;
  try {
    const redis = await getRedis();
    await redis.del(phoneKeyedRedisKeys(phone));
  } catch (err) {
    console.error("[user-deletion] Failed to purge phone-keyed Redis state:", err);
  }
}

export async function sendDeletionConfirmationEmail(email: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Your Ajosave account has been deleted",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2>Account Deletion Confirmed</h2>
        <p>Your personal data has been deleted from Ajosave in accordance with GDPR/NDPR.</p>
        <p>Financial transaction records are retained in anonymized form as required by law.</p>
        <p>If you did not request this, contact us immediately at <a href="mailto:security@ajosave.app">security@ajosave.app</a>.</p>
        <p>— The Ajosave Team</p>
      </div>
    `,
    text: "Your Ajosave account has been deleted. Financial records are retained in anonymized form as required by law. Contact security@ajosave.app if you did not request this.",
  });
}
