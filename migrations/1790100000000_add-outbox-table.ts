import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("outbox_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    aggregate_type: { type: "varchar(100)", notNull: true },
    aggregate_id: { type: "varchar(255)", notNull: true },
    event_type: { type: "varchar(100)", notNull: true },
    payload: { type: "jsonb", notNull: true },
    status: { type: "varchar(20)", notNull: true, default: "'pending'" },
    attempts: { type: "integer", notNull: true, default: 0 },
    last_error: { type: "text" },
    scheduled_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
    processed_at: { type: "timestamp" },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("outbox_events", ["status", "scheduled_at"]);
  pgm.createIndex("outbox_events", ["aggregate_type", "aggregate_id"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("outbox_events");
}
