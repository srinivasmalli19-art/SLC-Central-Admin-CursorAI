import { describe, expect, it } from 'vitest';

import { IntegrationError } from './errors.js';
import { CircuitBreaker, withRetry, withTimeout } from './policies.js';

const noSleep = async () => {};

describe('withTimeout', () => {
  it('resolves when the task completes in time', async () => {
    await expect(withTimeout(async () => 'ok', 1000)).resolves.toBe('ok');
  });

  it('rejects with TIMEOUT when the task exceeds the deadline', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<string>((_res, rej) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        });
      });
    await expect(withTimeout(hang, 10)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('withRetry', () => {
  it('retries retryable failures then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new IntegrationError('UPSTREAM_5XX', 'transient', { retryable: true });
        return 'done';
      },
      { retries: 5, baseDelayMs: 1, jitter: false, sleep: noSleep },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new IntegrationError('UNAUTHORIZED', 'no', { retryable: false });
        },
        { retries: 5, baseDelayMs: 1, jitter: false, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls).toBe(1);
  });

  it('gives up after the retry budget', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new IntegrationError('TIMEOUT', 'slow', { retryable: true });
        },
        { retries: 2, baseDelayMs: 1, jitter: false, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(calls).toBe(3); // initial + 2 retries
  });
});

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and short-circuits', async () => {
    const clock = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, now: () => clock });
    const boom = () => Promise.reject(new IntegrationError('UPSTREAM_5XX', 'x', { retryable: true }));

    await expect(breaker.exec(boom)).rejects.toMatchObject({ code: 'UPSTREAM_5XX' });
    await expect(breaker.exec(boom)).rejects.toMatchObject({ code: 'UPSTREAM_5XX' });
    expect(breaker.getState()).toBe('OPEN');
    // Now short-circuits without calling the task.
    await expect(breaker.exec(boom)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
  });

  it('half-opens after the reset timeout and closes on success', async () => {
    let clock = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => clock });
    await expect(
      breaker.exec(() => Promise.reject(new IntegrationError('NETWORK', 'x', { retryable: true }))),
    ).rejects.toBeDefined();
    expect(breaker.getState()).toBe('OPEN');

    clock += 1001; // elapse reset window
    await expect(breaker.exec(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });
});
