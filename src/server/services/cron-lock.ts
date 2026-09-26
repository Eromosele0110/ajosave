/**
 * Cron lock utility to prevent overlapping executions of scheduled jobs.
 *
 * Uses an in-memory Set for single-instance deployments.
 * In a multi-instance deployment, replace with a distributed lock (e.g. Redis SET NX PX).
 */

const runningJobs = new Set<string>();

export class CronLockError extends Error {
  constructor(jobName: string) {
    super(`Cron job "${jobName}" is already running — skipping overlapping execution`);
    this.name = "CronLockError";
  }
}

/**
 * Acquire a lock for the given job name, run fn, then release.
 * If the job is already running, throws CronLockError immediately.
 *
 * @param jobName - unique identifier for the cron job
 * @param fn - async function to execute under the lock
 */
export async function withCronLock<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  if (runningJobs.has(jobName)) {
    throw new CronLockError(jobName);
  }

  runningJobs.add(jobName);
  try {
    return await fn();
  } finally {
    runningJobs.delete(jobName);
  }
}

/**
 * Check whether a cron job is currently running.
 */
export function isCronJobRunning(jobName: string): boolean {
  return runningJobs.has(jobName);
}
