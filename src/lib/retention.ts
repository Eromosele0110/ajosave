/**
 * Retention deletion jobs — Issue #43
 *
 * Deletes operational data past its retention window in bounded batches so a
 * large backlog never holds long locks. Financial records (contributions,
 * payouts) and audit_logs are deliberately NOT covered: they have regulatory
 * retention requirements and must never be purged by this job.
 *
 * Table/column names come only from the static POLICIES list below — never
 * from request input — so interpolating them into SQL is safe.
 */
import { query } from "./db";
import logger from "./logger";

export interface RetentionPolicy {
  table: string;
  column: string;
  days: number;
  /** Extra SQL predicate restricting which rows are eligible. */
  where?: string;
}

export const MIN_RETENTION_DAYS = 7;
export const DEFAULT_BATCH_SIZE = 1000;
export const MAX_BATCHES_PER_RUN = 50;

export const POLICIES: RetentionPolicy[] = [
  { table: "sessions", column: "expires_at", days: 7 },
  { table: "processed_webhooks", column: "created_at", days: 30 },
  { table: "sms_logs", column: "created_at", days: 90 },
  { table: "outbox_events", column: "processed_at", days: 30, where: "processed_at IS NOT NULL" },
];

export interface RetentionResult {
  table: string;
  deleted: number;
  dryRun: boolean;
  truncated: boolean;
  error?: string;
}

export function validatePolicy(p: RetentionPolicy): void {
  if (!/^[a-z_]+$/.test(p.table) || !/^[a-z_]+$/.test(p.column)) {
    throw new Error(`invalid identifier in retention policy for ${p.table}`);
  }
  if (!Number.isInteger(p.days) || p.days < MIN_RETENTION_DAYS) {
    throw new Error(`retention for ${p.table} must be an integer >= ${MIN_RETENTION_DAYS} days`);
  }
}

export async function applyPolicy(
  p: RetentionPolicy,
  opts: { dryRun?: boolean; batchSize?: number } = {}
): Promise<RetentionResult> {
  validatePolicy(p);
  const dryRun = opts.dryRun ?? false;
  const batchSize = Math.min(Math.max(opts.batchSize ?? DEFAULT_BATCH_SIZE, 1), 10000);
  const predicate = `${p.column} < NOW() - make_interval(days => $1)${p.where ? ` AND ${p.where}` : ""}`;

  if (dryRun) {
    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${p.table} WHERE ${predicate}`,
      [p.days]
    );
    return { table: p.table, deleted: Number(rows[0]?.count ?? 0), dryRun, truncated: false };
  }

  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const { rowCount } = await query(
      `DELETE FROM ${p.table} WHERE ctid IN (SELECT ctid FROM ${p.table} WHERE ${predicate} LIMIT $2)`,
      [p.days, batchSize]
    );
    deleted += rowCount ?? 0;
    if ((rowCount ?? 0) < batchSize) return { table: p.table, deleted, dryRun, truncated: false };
  }
  // Backlog remains; the next scheduled run continues where this one stopped.
  return { table: p.table, deleted, dryRun, truncated: true };
}

/** Run every policy; one failing table does not stop the others. */
export async function runRetention(
  opts: { dryRun?: boolean; batchSize?: number; policies?: RetentionPolicy[] } = {}
): Promise<RetentionResult[]> {
  const results: RetentionResult[] = [];
  for (const p of opts.policies ?? POLICIES) {
    try {
      const r = await applyPolicy(p, opts);
      logger.info(r, "[retention] policy applied");
      results.push(r);
    } catch (err) {
      const error = (err as Error).message;
      logger.error({ table: p.table, error }, "[retention] policy failed");
      results.push({ table: p.table, deleted: 0, dryRun: opts.dryRun ?? false, truncated: false, error });
    }
  }
  return results;
}
