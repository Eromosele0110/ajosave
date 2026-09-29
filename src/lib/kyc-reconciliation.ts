/**
 * KYC status reconciliation — Issue #42
 *
 * Webhooks from Smile Identity can be lost or rejected. This job finds users
 * stuck in 'pending' longer than a grace period, asks the provider for the
 * authoritative job status, and applies it. Updates are guarded with
 * `WHERE kyc_status = 'pending'` so a webhook that lands concurrently wins
 * and an 'approved' user is never downgraded by a stale read.
 */
import { query } from "./db";
import logger from "./logger";
import type { KycStatus } from "./kyc";
import { outboundPolicy, safeFetch } from "./ssrf";

const BASE_URL = "https://testapi.smileidentity.com/v1";
const KYC_POLICY = outboundPolicy({ allowedHosts: ["testapi.smileidentity.com"] });
export const DEFAULT_STALE_MINUTES = 30;
export const DEFAULT_BATCH_LIMIT = 100;

/** Provider result: a final status, or null when the job is still in progress. */
export type ProviderLookup = (userId: string) => Promise<Exclude<KycStatus, "none" | "pending"> | null>;

export async function fetchSmileJobStatus(userId: string) {
  const partnerId = process.env.SMILE_PARTNER_ID;
  const apiKey = process.env.SMILE_API_KEY;
  if (!partnerId || !apiKey) throw new Error("Missing Smile Identity credentials");

  const res = await safeFetch(`${BASE_URL}/job_status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partner_id: partnerId, api_key: apiKey, user_id: userId, job_id: userId }),
    signal: AbortSignal.timeout(10_000),
  }, KYC_POLICY);
  if (!res.ok) throw new Error(`Smile Identity job_status failed: HTTP ${res.status}`);
  const data = (await res.json()) as { job_complete?: boolean; result?: { ResultCode?: string } };
  if (!data.job_complete) return null;
  return data.result?.ResultCode === "1012" ? "approved" : "rejected";
}

export interface ReconcileSummary {
  scanned: number;
  approved: number;
  rejected: number;
  stillPending: number;
  skipped: number;
  failed: number;
}

export async function reconcileKycStatuses(
  opts: { staleMinutes?: number; limit?: number; lookup?: ProviderLookup } = {}
): Promise<ReconcileSummary> {
  const staleMinutes = Math.max(opts.staleMinutes ?? DEFAULT_STALE_MINUTES, 1);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_BATCH_LIMIT, 1), 1000);
  const lookup = opts.lookup ?? fetchSmileJobStatus;

  const { rows } = await query<{ id: string }>(
    `SELECT id FROM users
     WHERE kyc_status = 'pending'
       AND COALESCE(kyc_submitted_at, created_at) < NOW() - make_interval(mins => $1)
     ORDER BY COALESCE(kyc_submitted_at, created_at) ASC
     LIMIT $2`,
    [staleMinutes, limit]
  );

  const summary: ReconcileSummary = { scanned: rows.length, approved: 0, rejected: 0, stillPending: 0, skipped: 0, failed: 0 };

  for (const { id } of rows) {
    try {
      const status = await lookup(id);
      if (status === null) {
        summary.stillPending++;
        continue;
      }
      const { rowCount } = await query(
        `UPDATE users
         SET kyc_status = $1, kyc_verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END
         WHERE id = $2 AND kyc_status = 'pending'`,
        [status, id]
      );
      if (!rowCount) {
        summary.skipped++; // resolved concurrently (e.g. webhook arrived)
        continue;
      }
      summary[status]++;
      logger.info({ userId: id, status }, "[kyc-reconcile] status reconciled");
    } catch (err) {
      summary.failed++;
      logger.error({ userId: id, error: (err as Error).message }, "[kyc-reconcile] lookup failed");
    }
  }

  logger.info(summary, "[kyc-reconcile] run complete");
  return summary;
}
