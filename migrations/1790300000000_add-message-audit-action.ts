import { MigrationBuilder } from "node-pg-migrate";

/**
 * Extends audit_logs' action/target_type CHECK constraints to allow the
 * chat-moderation audit event introduced alongside DELETE
 * /api/circles/[id]/chat/[messageId] (issue #41): a circle admin or a
 * message's own author deleting a circle_messages row now writes a
 * DELETE_MESSAGE / MESSAGE audit entry, which the original constraints
 * (added in 1746800000000_add-audit-logs-table.ts) did not allow.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("audit_logs", "audit_logs_action_check");
  pgm.addConstraint("audit_logs", "audit_logs_action_check", {
    check:
      "action IN ('TRIGGER_PAYOUT', 'REMOVE_MEMBER', 'DELETE_USER', 'DELETE_CIRCLE', 'UPDATE_CIRCLE', 'DELETE_MESSAGE', 'ADMIN_OVERRIDE', 'PRIVILEGE_ESCALATION', 'SECRET_ACCESS', 'KYC_OVERRIDE', 'FORCED_PAYOUT', 'CIRCLE_CONFIG_CHANGE', 'BULK_OPERATION', 'ACCOUNT_SUSPENSION', 'DISPUTE_RESOLUTION', 'FEE_WAIVER', 'OTHER')",
  });

  pgm.dropConstraint("audit_logs", "audit_logs_target_type_check");
  pgm.addConstraint("audit_logs", "audit_logs_target_type_check", {
    check: "target_type IN ('CIRCLE', 'MEMBER', 'USER', 'PAYOUT', 'MESSAGE', 'OTHER')",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("audit_logs", "audit_logs_target_type_check");
  pgm.addConstraint("audit_logs", "audit_logs_target_type_check", {
    check: "target_type IN ('CIRCLE', 'MEMBER', 'USER', 'PAYOUT', 'OTHER')",
  });

  pgm.dropConstraint("audit_logs", "audit_logs_action_check");
  pgm.addConstraint("audit_logs", "audit_logs_action_check", {
    check:
      "action IN ('TRIGGER_PAYOUT', 'REMOVE_MEMBER', 'DELETE_USER', 'DELETE_CIRCLE', 'UPDATE_CIRCLE', 'OTHER')",
  });
}
