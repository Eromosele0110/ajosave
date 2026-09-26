/**
 * Provider circuit breaker — prevents cascading failures when an external
 * service (Stellar, Paystack, SMS gateway, etc.) becomes unavailable.
 *
 * States:
 *   CLOSED  — normal operation; failures increment a counter
 *   OPEN    — provider is considered down; calls fail fast for `resetTimeoutMs`
 *   HALF_OPEN — one probe call is allowed through; success closes the circuit,
 *               failure re-opens it
 *
 * Usage:
 *   const breaker = new CircuitBreaker("stellar", { failureThreshold: 3 });
 *   const result  = await breaker.execute(() => sendUsdcPayment(key, amount));
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait before attempting a probe call. Default: 30 000 */
  resetTimeoutMs?: number;
  /** Optional name used in error/log messages. */
  name?: string;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is OPEN — provider unavailable, call rejected`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime?: number;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  readonly name: string;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute `fn` through the circuit breaker.
   * Throws `CircuitOpenError` when the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      // Check if reset timeout has elapsed — if so, allow one probe
      if (Date.now() - (this.lastFailureTime ?? 0) >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        console.info(`[circuit-breaker] "${this.name}" → HALF_OPEN (probing)`);
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      console.info(`[circuit-breaker] "${this.name}" → CLOSED (probe succeeded)`);
    }
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = undefined;
  }

  private onFailure(err: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      console.error(
        `[circuit-breaker] "${this.name}" → OPEN after ${this.failureCount} failure(s):`,
        err instanceof Error ? err.message : err
      );
    } else {
      console.warn(
        `[circuit-breaker] "${this.name}" failure ${this.failureCount}/${this.failureThreshold}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /** Manually reset the circuit to CLOSED (e.g. from a health-check endpoint). */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    console.info(`[circuit-breaker] "${this.name}" manually reset → CLOSED`);
  }
}

/**
 * Pre-configured breakers for each external provider.
 * Import and use these singletons rather than creating new instances.
 */
export const stellarBreaker = new CircuitBreaker("stellar", {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
});

export const paystackBreaker = new CircuitBreaker("paystack", {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

export const smsBreaker = new CircuitBreaker("sms", {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});
