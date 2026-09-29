/**
 * Migration: users.kyc_submitted_at (Issue #42)
 * Records when a KYC session was started so reconciliation can find stale 'pending' users.
 */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("users", { kyc_submitted_at: { type: "timestamp" } });
  pgm.sql("UPDATE users SET kyc_submitted_at = created_at WHERE kyc_status = 'pending'");
  pgm.createIndex("users", ["kyc_status", "kyc_submitted_at"], { name: "users_kyc_pending_idx" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("users", ["kyc_status", "kyc_submitted_at"], { name: "users_kyc_pending_idx", ifExists: true });
  pgm.dropColumns("users", ["kyc_submitted_at"]);
}
