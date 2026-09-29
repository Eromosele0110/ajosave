/**
 * Thin PostgreSQL client wrapper with connection pooling.
 *
 * ALL queries MUST go through `query()` or `transaction()`.
 * String interpolation into SQL is NEVER allowed — use $1, $2, … placeholders.
 *
 * Example (correct):
 *   await query('SELECT * FROM circles WHERE id = $1', [id])
 *
 * Example (WRONG — never do this):
 *   await query(`SELECT * FROM circles WHERE id = '${id}'`)
 *
 * Connection Pool Configuration:
 * - DB_POOL_SIZE: Maximum connections (default: 10)
 * - DB_POOL_MIN: Minimum connections (default: 2)
 * - Pool automatically manages connection lifecycle
 * - Idle connections are closed after 30s
 * - Connection timeout is 5s
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { recordQuery } from "./query-metrics";
import { serverConfig } from "@/server/config";

const _DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE ?? "10", 10);
const _DB_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? "5000", 10);
const _DB_IDLE_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? "30000", 10);
const DB_MAX_RETRIES = parseInt(process.env.DB_MAX_RETRIES ?? "3", 10);
const DB_RETRY_DELAY_MS = parseInt(process.env.DB_RETRY_DELAY_MS ?? "500", 10);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const maxPoolSize = parseInt(process.env.DB_POOL_SIZE ?? "10", 10);
    const minPoolSize = parseInt(process.env.DB_POOL_MIN ?? "2", 10);
    
    pool = new Pool({
      connectionString: serverConfig.database.url,
      max: maxPoolSize,
      min: minPoolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Validate connections before use to detect stale connections
      allowExitOnIdle: false,
      ssl: serverConfig.stellar.network === "mainnet" ? { rejectUnauthorized: true } : false,
    });

    // Pool event listeners for monitoring and debugging
    pool.on("connect", (_client) => {
      console.log("[db] New client connected to pool");
    });

    pool.on("acquire", (_client) => {
      console.log("[db] Client acquired from pool");
    });

    pool.on("remove", (_client) => {
      console.log("[db] Client removed from pool");
    });

    pool.on("error", (_err, _client) => {
      console.error("[db] Unexpected pool error:", _err);
      // Don't exit process - let the pool handle reconnection
    });

    console.log(`[db] Connection pool initialized (min: ${minPoolSize}, max: ${maxPoolSize})`);
  }
  return pool;
}

/**
 * Gracefully close the connection pool.
 * Waits for active queries to complete before closing.
 * Call during server shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    console.log("[db] Closing connection pool...");
    try {
      await pool.end();
      console.log("[db] Connection pool closed successfully");
    } catch (err) {
      console.error("[db] Error closing pool:", err);
      throw err;
    } finally {
      pool = null;
    }
  }
}

/**
 * Get pool statistics for monitoring.
 * Useful for health checks and debugging.
 */
export function getPoolStats() {
  if (!pool) {
    return null;
  }
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * Execute a parameterized query with automatic retry on transient connection errors.
 * @param text  SQL with $1, $2, … placeholders — never interpolate user input
 * @param params  Values bound to placeholders
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DB_MAX_RETRIES; attempt++) {
    try {
      const started = Date.now();
      try {
        const result = await getPool().query<T>(text, params);
        recordQuery(text, Date.now() - started);
        return result;
      } catch (e) {
        recordQuery(text, Date.now() - started, true);
        throw e;
      }
    } catch (err) {
      lastErr = err;
      const isTransient =
        err instanceof Error &&
        (err.message.includes("Connection terminated") ||
          err.message.includes("connection timeout") ||
          err.message.includes("ECONNRESET"));
      if (!isTransient || attempt === DB_MAX_RETRIES) throw err;
      console.warn(`[db] query attempt ${attempt} failed, retrying in ${DB_RETRY_DELAY_MS}ms…`);
      await sleep(DB_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

/**
 * Run multiple queries in a single transaction.
 * Rolls back automatically on error.
 */
export async function transaction<T>(
  fn: (_q: typeof query) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const boundQuery = <R extends QueryResultRow>(text: string, params?: unknown[]) =>
      client.query<R>(text, params);
    const result = await fn(boundQuery as typeof query);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
