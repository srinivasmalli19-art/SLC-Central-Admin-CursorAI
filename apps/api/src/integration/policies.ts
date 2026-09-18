import { IntegrationError, normalizeError } from './errors.js';

/**
 * Reusable failure-handling policies applied by the Integration Layer AROUND
 * adapters, so every integration behaves consistently and one external system
 * cannot destabilize the core. These are pure/deterministic and fully testable
 * with fake timers — they perform no I/O themselves.
 */

/** Run a task with a hard timeout. Rejects with a TIMEOUT IntegrationError. */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new IntegrationError('TIMEOUT', 'Operation timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  factor?: number;
  jitter?: boolean;
  /** Deterministic sleeper (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** RNG in [0,1) (injectable for tests). */
  random?: () => number;
}

/** Retry a task with exponential backoff + optional jitter (retryable only). */
export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { retries, baseDelayMs, factor = 2, jitter = true } = options;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await task();
    } catch (error) {
      const normalized = normalizeError(error);
      if (!normalized.retryable || attempt >= retries) {
        throw normalized;
      }
      const backoff = baseDelayMs * factor ** attempt;
      const delay = jitter ? backoff * (0.5 + random() * 0.5) : backoff;
      await sleep(delay);
      attempt += 1;
    }
  }
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Per-target circuit breaker. After `failureThreshold` consecutive failures it
 * OPENs and short-circuits calls (CIRCUIT_OPEN) until `resetTimeoutMs` elapses,
 * then allows a single HALF_OPEN trial.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    return this.state;
  }

  async exec<T>(task: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt >= this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new IntegrationError('CIRCUIT_OPEN', 'Circuit breaker is open.');
      }
    }

    try {
      const result = await task();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw normalizeError(error);
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
