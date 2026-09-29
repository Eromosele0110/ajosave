import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: financial database constraints (#27).
 *
 * Adds CHECK constraints so the database itself rejects invalid money values,
 * regardless of which code path writes them. Constraints are added NOT VALID
 * and then validated so existing deployments fail loudly on bad legacy rows
 * instead of silently skipping them.
 */
const CONSTRAINTS: Array<[table: string, name: string, check: string]> = [
  ["circles", "circles_contribution_usdc_positive", "contribution_usdc > 0"],
  ["circles", "circles_contribution_ngn_non_negative", "contribution_ngn >= 0"],
  ["circles", "circles_current_cycle_non_negative", "current_cycle >= 0"],
  ["contributions", "contributions_amount_usdc_positive", "amount_usdc > 0"],
  [
    "contributions",
    "contributions_amount_paid_bounds",
    "amount_paid_usdc >= 0 AND amount_paid_usdc <= amount_usdc",
  ],
  ["payouts", "payouts_amount_usdc_positive", "amount_usdc > 0"],
  ["payouts", "payouts_retry_count_non_negative", "retry_count >= 0"],
];

export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const [table, name, check] of CONSTRAINTS) {
    pgm.sql(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID;`);
    pgm.sql(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name};`);
  }

  // A member can only contribute once per cycle.
  pgm.createIndex("contributions", ["member_id", "cycle_number"], {
    name: "contributions_member_cycle_unique",
    unique: true,
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("contributions", ["member_id", "cycle_number"], {
    name: "contributions_member_cycle_unique",
  });
  for (const [table, name] of [...CONSTRAINTS].reverse()) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};`);
  }
}
