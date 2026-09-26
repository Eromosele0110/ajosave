import { query } from "@/lib/db";

/**
 * Add privilege column to audit_logs to flag privileged events.
 * Backfills existing rows as 'STANDARD'.
 */
export async function up(): Promise<void> {
  await query(`
    ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS privilege TEXT NOT NULL DEFAULT 'STANDARD'
        CHECK (privilege IN ('STANDARD', 'PRIVILEGED'))
  `);

  // Mark known privileged action types that already exist in the table
  await query(`
    UPDATE audit_logs
    SET privilege = 'PRIVILEGED'
    WHERE action IN (
      'ADMIN_OVERRIDE', 'PRIVILEGE_ESCALATION', 'SECRET_ACCESS',
      'KYC_OVERRIDE', 'FORCED_PAYOUT', 'BULK_OPERATION',
      'ACCOUNT_SUSPENSION', 'FEE_WAIVER'
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_privilege
      ON audit_logs (privilege, created_at DESC)
  `);
}

export async function down(): Promise<void> {
  await query(`DROP INDEX IF EXISTS idx_audit_logs_privilege`);
  await query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS privilege`);
}
