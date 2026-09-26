/**
 * Server startup initialization
 * Starts background services when the Next.js server boots
 */

import { startHorizonStream } from "./services/horizon-stream.service";
import { startEventIndexer } from "./services/event-indexer.service";
import { closePool } from "@/lib/db";
import { serverConfig } from "./config";

let initialized = false;

/**
 * Validate critical environment variables at startup
 */
function validateEnvironment(): void {
  const errors: string[] = [];

  if (!serverConfig.cronSecret) {
    errors.push("CRON_SECRET is not set — cron endpoints will reject all requests");
  }

  if (!serverConfig.database.url) {
    errors.push("DATABASE_URL is not set");
  }

  if (!serverConfig.stellar.serverSecretKey) {
    errors.push("STELLAR_SERVER_SECRET_KEY is not set");
  }

  if (errors.length > 0) {
    console.error("[startup] ⚠️  Environment validation failed:");
    errors.forEach((err) => console.error(`  - ${err}`));
    console.error("[startup] Set missing variables in .env.local (see .env.example)");
  }
}

/**
 * Initialize all background services
 * Should be called once when the server starts
 */
export async function initializeServices(): Promise<void> {
  if (initialized) {
    console.warn("[startup] Services already initialized");
    return;
  }

  console.log("[startup] Initializing background services...");

  // Validate environment variables first
  validateEnvironment();

  try {
    // Start Horizon payment stream
    if (process.env.ENABLE_HORIZON_STREAM !== "false") {
      await startHorizonStream();
      console.log("[startup] ✓ Horizon stream started");
    } else {
      console.log("[startup] ⊘ Horizon stream disabled");
    }

    // Add other background services here
    // e.g., Redis connection, scheduled jobs, etc.

    // Start Soroban contract event indexer
    if (process.env.ENABLE_EVENT_INDEXER !== "false") {
      startEventIndexer();
      console.log("[startup] ✓ Contract event indexer started");
    } else {
      console.log("[startup] ⊘ Contract event indexer disabled");
    }

    initialized = true;
    console.log("[startup] All services initialized successfully");
  } catch (error) {
    console.error("[startup] Failed to initialize services:", error);
    throw error;
  }
}

/**
 * Graceful shutdown of all services
 */
export async function shutdownServices(): Promise<void> {
  console.log("[startup] Shutting down services...");

  const { stopHorizonStream } = await import("./services/horizon-stream.service");
  stopHorizonStream();

  const { stopEventIndexer } = await import("./services/event-indexer.service");
  stopEventIndexer();

  // Drain the BullMQ payout worker before closing the DB pool so that any
  // in-flight job can complete its DB writes cleanly.
  try {
    const { shutdownWorker } = await import("@/lib/queue/worker");
    await shutdownWorker();
  } catch (err) {
    // Worker may not have been started (e.g. in test environments) — log and
    // continue so the rest of the shutdown sequence still runs.
    console.warn("[startup] Worker shutdown warning:", err);
  }

  await closePool();

  initialized = false;
  console.log("[startup] Services shut down");
}

// Handle process termination
if (typeof process !== "undefined") {
  process.on("SIGTERM", async () => {
    console.log("[startup] SIGTERM received");
    await shutdownServices();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("[startup] SIGINT received");
    await shutdownServices();
    process.exit(0);
  });
}
