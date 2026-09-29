/**
 * Dependency readiness checks — Issue #44
 *
 * Unlike /api/health (liveness + informational), readiness answers
 * "may this instance receive traffic?". Each dependency is probed with a
 * hard timeout so a hung dependency cannot hang the probe itself.
 */
import { query } from "./db";
import { getRedis } from "./redis";

export type CheckStatus = "ok" | "error";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  critical: boolean;
  durationMs: number;
  error?: string;
}

export interface ReadinessCheck {
  name: string;
  critical: boolean;
  run: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2000;
const REQUIRED_ENV = ["DATABASE_URL"];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export const defaultChecks: ReadinessCheck[] = [
  {
    name: "env",
    critical: true,
    run: async () => {
      const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
      if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);
    },
  },
  { name: "database", critical: true, run: async () => { await query("SELECT 1"); } },
  {
    name: "redis",
    critical: false, // rate limiting / caching degrade gracefully without Redis
    run: async () => {
      const redis = await getRedis();
      const pong = await (redis as any).ping();
      if (pong !== "PONG") throw new Error(`unexpected ping reply: ${pong}`);
    },
  },
];

export async function checkReadiness(
  checks: ReadinessCheck[] = defaultChecks,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ ready: boolean; checks: CheckResult[] }> {
  const results = await Promise.all(
    checks.map(async (c): Promise<CheckResult> => {
      const start = Date.now();
      try {
        await withTimeout(c.run(), timeoutMs);
        return { name: c.name, status: "ok", critical: c.critical, durationMs: Date.now() - start };
      } catch (err) {
        return {
          name: c.name,
          status: "error",
          critical: c.critical,
          durationMs: Date.now() - start,
          error: (err as Error).message,
        };
      }
    })
  );
  const ready = results.every((r) => r.status === "ok" || !r.critical);
  return { ready, checks: results };
}
