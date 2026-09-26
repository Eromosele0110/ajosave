import { MigrationBuilder } from "node-pg-migrate";

/**
 * Adds the error_logs table for persisting unhandled/unexpected application errors.
 *
 * This table stores structured error envelopes produced by the AppError class so
 * that ops teams can query, alert on, and diagnose production failures without
 * relying solely on an external service such as Sentry.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("error_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    /** Machine-readable error code, e.g. 'INTERNAL_ERROR', 'NOT_FOUND' */
    code: {
      type: "varchar(100)",
      notNull: true,
    },
    /** Human-readable error message */
    message: {
      type: "text",
      notNull: true,
    },
    /** HTTP status code returned to the client */
    status_code: {
      type: "smallint",
      notNull: true,
    },
    /** Optional structured details (field errors, context, etc.) */
    details: {
      type: "jsonb",
      default: "null",
    },
    /** Originating URL path */
    path: {
      type: "text",
    },
    /** HTTP method (GET, POST, …) */
    method: {
      type: "varchar(10)",
    },
    /** x-correlation-id / x-request-id from the request */
    correlation_id: {
      type: "varchar(100)",
    },
    /** Sentry event ID if the error was forwarded to Sentry */
    sentry_event_id: {
      type: "varchar(100)",
    },
    /** Full stack trace captured at throw time */
    stack_trace: {
      type: "text",
    },
    /** Authenticated user ID when available */
    user_id: {
      type: "varchar(255)",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  // Efficient querying by code, time range, and correlation
  pgm.createIndex("error_logs", "code");
  pgm.createIndex("error_logs", "status_code");
  pgm.createIndex("error_logs", "created_at");
  pgm.createIndex("error_logs", "correlation_id");
  pgm.createIndex("error_logs", "user_id");
  pgm.createIndex("error_logs", ["code", "created_at"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("error_logs");
}
