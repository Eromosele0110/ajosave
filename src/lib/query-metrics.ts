/**
 * Query performance monitoring — Issue #45
 *
 * Records per-statement latency in memory and logs slow queries.
 * SQL is normalised (literals stripped, whitespace collapsed) so parameter
 * values — which may contain PII or financial data — are never logged.
 *
 * Env:
 *   DB_SLOW_QUERY_MS — threshold for slow-query warnings (default 500)
 */
import logger from "./logger";

const MAX_TRACKED = 500;

export interface QueryStat {
  sql: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  slowCount: number;
}

const stats = new Map<string, QueryStat>();

export function slowQueryThresholdMs(): number {
  const v = Number(process.env.DB_SLOW_QUERY_MS);
  return Number.isFinite(v) && v > 0 ? v : 500;
}

export function normalizeSql(text: string): string {
  return text
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\b\d+(\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function recordQuery(text: string, durationMs: number, failed = false): void {
  const sql = normalizeSql(text);
  let s = stats.get(sql);
  if (!s) {
    if (stats.size >= MAX_TRACKED) return; // bound memory under unbounded query shapes
    s = { sql, count: 0, errors: 0, totalMs: 0, maxMs: 0, slowCount: 0 };
    stats.set(sql, s);
  }
  s.count++;
  s.totalMs += durationMs;
  s.maxMs = Math.max(s.maxMs, durationMs);
  if (failed) s.errors++;
  if (durationMs >= slowQueryThresholdMs()) {
    s.slowCount++;
    logger.warn({ sql, durationMs, failed }, "[db] slow query");
  }
}

/** Top-N statements by total time, with average latency. */
export function getQueryStats(limit = 20) {
  return [...stats.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, Math.max(1, limit))
    .map((s) => ({ ...s, avgMs: s.count ? s.totalMs / s.count : 0 }));
}

export function resetQueryStats(): void {
  stats.clear();
}
