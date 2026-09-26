import { Worker } from "bullmq";
import { redisConnection, payoutQueue } from "./payoutQueue";
import { processCyclePayout } from "@/server/services/payout.service";
import { query } from "@/lib/db";

/** Timeout (ms) to wait for in-flight jobs before forcing shutdown. */
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? "30000", 10);

const worker = new Worker(
  "payouts",
  async (job) => {
    const { circleId, cycleNumber } = job.data as { circleId: string; cycleNumber: number };
    console.log(`[payout-worker] Starting job ${job.id} for ${circleId}:${cycleNumber}`);

    const { rows } = await query<{ stellar_public_key: string | null }>(
      `SELECT u.stellar_public_key
       FROM members m
       JOIN users u ON u.id = m.user_id
       WHERE m.circle_id = $1 AND m.position = $2 LIMIT 1`,
      [circleId, cycleNumber]
    );
    const stellarKey = rows[0]?.stellar_public_key ?? "";

    await processCyclePayout(circleId, stellarKey);
    console.log(`[payout-worker] Completed job ${job.id} for ${circleId}:${cycleNumber}`);
    return { success: true };
  },
  { connection: redisConnection, concurrency: 1 }
);

worker.on("active", (job) => {
  console.log(`[payout-worker] Job ${job.id} active: ${job.data.circleId}:${job.data.cycleNumber}`);
});

worker.on("completed", (job) => {
  console.log(`[payout-worker] Job ${job.id} completed: ${job.data.circleId}:${job.data.cycleNumber}`);
});

worker.on("failed", (job, err) => {
  console.error(`[payout-worker] Job ${job?.id} failed: ${job?.data?.circleId}:${job?.data?.cycleNumber}`, err);
});

/**
 * Gracefully close the BullMQ worker and the shared Redis connection.
 *
 * - Tells the worker to stop picking up new jobs.
 * - Waits up to WORKER_SHUTDOWN_TIMEOUT_MS for any in-flight job to finish.
 * - Closes the payout queue and Redis connection afterwards.
 * - Safe to call multiple times (idempotent via `_shuttingDown` flag).
 */
let _shuttingDown = false;

export async function shutdownWorker(): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;

  console.log("[payout-worker] Graceful shutdown initiated…");

  const shutdownTimeout = setTimeout(() => {
    console.error(
      `[payout-worker] Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) exceeded — forcing exit`
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // worker.close(force=false) waits for the current job to finish.
    await worker.close();
    console.log("[payout-worker] Worker closed (in-flight jobs drained)");

    // Close the queue client (used for adding jobs — not the worker connection).
    await payoutQueue.close();
    console.log("[payout-worker] Payout queue closed");

    // Close the shared Redis connection last.
    await redisConnection.quit();
    console.log("[payout-worker] Redis connection closed");
  } catch (err) {
    console.error("[payout-worker] Error during shutdown:", err);
    throw err;
  } finally {
    clearTimeout(shutdownTimeout);
    console.log("[payout-worker] Shutdown complete");
  }
}

// ── Process signal handlers ────────────────────────────────────────────────────
// Register SIGTERM / SIGINT so that the worker shuts down cleanly when the
// Next.js process (or container orchestrator) sends a termination signal.
// The handlers in startup.ts also call shutdownServices(), which does NOT
// stop the worker — this file owns the worker lifecycle.

process.on("SIGTERM", async () => {
  console.log("[payout-worker] SIGTERM received");
  await shutdownWorker();
});

process.on("SIGINT", async () => {
  console.log("[payout-worker] SIGINT received");
  await shutdownWorker();
});

export default worker;
