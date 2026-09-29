import type { Knex } from "knex";

/**
 * Migration: add support_tickets table (#123 — Support Intake)
 *
 * Stores user-submitted support requests.
 *
 * Columns:
 *   id          — UUID primary key
 *   user_id     — FK → users.id (cascade delete so tickets are removed with the account)
 *   category    — enum-style varchar: payment_issue | circle_dispute | account_access |
 *                 payout_issue | general | other
 *   subject     — short summary (≤ 200 chars)
 *   description — full description (text, ≤ 5 000 chars enforced at app layer)
 *   status      — open | in_progress | resolved | closed (default: open)
 *   circle_id   — optional FK → circles.id (set null on circle delete)
 *   created_at  — submission timestamp
 *   updated_at  — last status-change timestamp
 *
 * Indexes:
 *   idx_support_tickets_user_id — list tickets per user efficiently
 *   idx_support_tickets_status  — allow admin dashboards to filter by status
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("support_tickets", (t) => {
    t.uuid("id").primary();
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("category", 50).notNullable();
    t.string("subject", 200).notNullable();
    t.text("description").notNullable();
    t.string("status", 20).notNullable().defaultTo("open");
    t.uuid("circle_id").nullable().references("id").inTable("circles").onDelete("SET NULL");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    t.index(["user_id"], "idx_support_tickets_user_id");
    t.index(["status"], "idx_support_tickets_status");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("support_tickets");
}
