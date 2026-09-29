import { MigrationBuilder } from "node-pg-migrate";

/**
 * Issue #120: Add referral_fraud_audit_log table.
 *
 * Stores every fraud detection event from the referral validation service so
 * that admins can investigate suspicious patterns and the IP / phone velocity
 * checks can query recent events efficiently.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("referral_fraud_audit_log", {
    id: { type: "uuid", primaryKey: true },
    referrer_id: {
      type: "varchar(255)",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    suspect_user_id: {
      type: "varchar(255)",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    referral_code: { type: "varchar(16)" },
    reason: {
      type: "varchar(50)",
      notNull: true,
      // SELF_REFERRAL | ALREADY_REFERRED | VELOCITY_LIMIT | IP_LIMIT | INVALID_CODE | UNKNOWN
    },
    ip_address: { type: "varchar(45)" }, // IPv4 or IPv6
    metadata: { type: "jsonb", default: "'{}'" },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });

  // Support admin listing by referrer
  pgm.createIndex("referral_fraud_audit_log", ["referrer_id"], {
    name: "idx_rfal_referrer_id",
    ifNotExists: true,
  });

  // IP velocity check: query by ip_address + time window
  pgm.createIndex("referral_fraud_audit_log", ["ip_address", "created_at"], {
    name: "idx_rfal_ip_created_at",
    ifNotExists: true,
  });

  // Time-range queries for admin dashboards and pruning jobs
  pgm.createIndex("referral_fraud_audit_log", ["created_at"], {
    name: "idx_rfal_created_at",
    ifNotExists: true,
  });

  // Reason-based queries (velocity dashboards)
  pgm.createIndex("referral_fraud_audit_log", ["reason"], {
    name: "idx_rfal_reason",
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON TABLE referral_fraud_audit_log IS
      'Audit log for all referral fraud detection events — used by checkReferralFraud() and IP velocity checks (#120)';
    COMMENT ON COLUMN referral_fraud_audit_log.reason IS
      'SELF_REFERRAL | ALREADY_REFERRED | VELOCITY_LIMIT | IP_LIMIT | INVALID_CODE | UNKNOWN';
    COMMENT ON COLUMN referral_fraud_audit_log.metadata IS
      'JSON blob with additional context (e.g. velocity counts, limits).';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("referral_fraud_audit_log", ["reason"], {
    name: "idx_rfal_reason",
    ifExists: true,
  });
  pgm.dropIndex("referral_fraud_audit_log", ["created_at"], {
    name: "idx_rfal_created_at",
    ifExists: true,
  });
  pgm.dropIndex("referral_fraud_audit_log", ["ip_address", "created_at"], {
    name: "idx_rfal_ip_created_at",
    ifExists: true,
  });
  pgm.dropIndex("referral_fraud_audit_log", ["referrer_id"], {
    name: "idx_rfal_referrer_id",
    ifExists: true,
  });
  pgm.dropTable("referral_fraud_audit_log");
}
