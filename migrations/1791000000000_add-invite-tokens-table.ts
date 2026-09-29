import { MigrationBuilder } from "node-pg-migrate";

/**
 * Issue #117: Add invite_tokens table for expiring, single-use invite links.
 *
 * Tokens are:
 *   - 64-char hex strings (32 random bytes)
 *   - Scoped to a circle and creator
 *   - Single-use: used_at / used_by populated on acceptance
 *   - Expire after 48 hours by default
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("invite_tokens", {
    token: { type: "varchar(64)", primaryKey: true },
    circle_id: {
      type: "varchar(255)",
      notNull: true,
      references: "circles(id)",
      onDelete: "CASCADE",
    },
    created_by: {
      type: "varchar(255)",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    expires_at: { type: "timestamp", notNull: true },
    used_at: { type: "timestamp" },
    used_by: {
      type: "varchar(255)",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });

  // Fast lookup by token (primary key covers this, but explicit for clarity)
  pgm.createIndex("invite_tokens", ["circle_id"], {
    name: "idx_invite_tokens_circle_id",
    ifNotExists: true,
  });

  // Efficiently find unexpired, unused tokens for a given circle
  pgm.createIndex("invite_tokens", ["expires_at"], {
    name: "idx_invite_tokens_expires_at",
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON TABLE invite_tokens IS
      'Single-use expiring invite tokens for private circle membership invites (#117)';
    COMMENT ON COLUMN invite_tokens.token IS
      'Cryptographically random 64-char hex token (32 bytes). Primary key.';
    COMMENT ON COLUMN invite_tokens.used_at IS
      'Populated when the token is consumed. NULL means the token has not been used yet.';
    COMMENT ON COLUMN invite_tokens.used_by IS
      'User ID of the person who accepted the invite.';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("invite_tokens", ["expires_at"], {
    name: "idx_invite_tokens_expires_at",
    ifExists: true,
  });
  pgm.dropIndex("invite_tokens", ["circle_id"], {
    name: "idx_invite_tokens_circle_id",
    ifExists: true,
  });
  pgm.dropTable("invite_tokens");
}
