import type { AdapterCapability } from '@slc/shared';

import { IntegrationError } from '../errors.js';
import type { AdapterContext, ApplicationAdapter, ConnectionInfo } from './types.js';

export type MockBehavior = 'ok' | 'fail' | 'timeout' | 'flaky';

export interface MockAdapterOptions {
  behavior?: MockBehavior;
  capabilities?: AdapterCapability[];
  /** For 'flaky': number of retryable failures before succeeding. */
  failuresBeforeSuccess?: number;
}

/**
 * In-memory test double and demo adapter. Performs NO network I/O under any
 * behavior. Used by the test suite to exercise the Integration Layer (timeout,
 * retry, circuit breaker, capabilities, status transitions) and available as a
 * safe 'mock' adapter that never contacts an external system.
 */
export class MockAdapter implements ApplicationAdapter {
  readonly type = 'mock';
  private attempts = 0;

  constructor(private readonly options: MockAdapterOptions = {}) {}

  describeCapabilities(): AdapterCapability[] {
    return this.options.capabilities ?? ['connection.validate', 'application.info'];
  }

  async validateConnection(ctx: AdapterContext): Promise<ConnectionInfo> {
    const behavior = this.options.behavior ?? 'ok';

    if (behavior === 'timeout') {
      // Never resolve; reject only when the caller's timeout aborts the signal.
      return new Promise<ConnectionInfo>((_resolve, reject) => {
        ctx.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }

    if (behavior === 'fail') {
      throw new IntegrationError('UNAUTHORIZED', 'Mock adapter simulated failure.', {
        retryable: false,
      });
    }

    if (behavior === 'flaky') {
      const failures = this.options.failuresBeforeSuccess ?? 1;
      if (this.attempts < failures) {
        this.attempts += 1;
        throw new IntegrationError('UPSTREAM_5XX', 'Mock adapter transient failure.', {
          retryable: true,
        });
      }
    }

    return { detail: 'mock connection ok' };
  }

  async getApplicationInfo(): Promise<Record<string, unknown>> {
    return { adapter: 'mock', note: 'simulated, no external system' };
  }
}
