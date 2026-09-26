import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: add a created_at index and an expires_at column to processed_webhooks.
 *
 * The index speeds up TTL-style cleanup queries (DELETE WHERE created_at < ...)
 * and the deduplication window check (WHERE created_at >= NOW() - INTERVAL '24 HOURS').
 *
 * The expires_at column allows the application to stamp an explicit expiry time
 * when inserting a webhook record, enabling a future background job to prune
 * expired rows without a full-table scan.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex("processed_webhooks", ["created_at"]);

  // Add expires_at for TTL-style cleanup
  pgm.addColumns("processed_webhooks", {
    expires_at: { type: "timestamp", notNull: false },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("processed_webhooks", ["expires_at"]);
  pgm.dropIndex("processed_webhooks", ["created_at"]);
}
