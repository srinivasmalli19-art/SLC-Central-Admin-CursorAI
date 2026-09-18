import { describe, expect, it, vi } from 'vitest';

import { AdapterRegistry, defaultAdapterRegistry } from './registry.js';
import { MockAdapter } from './mockAdapter.js';
import { NoopAdapter } from './noopAdapter.js';
import type { AdapterContext } from './types.js';

const ctx: AdapterContext = {
  correlationId: 'test',
  environment: 'DEVELOPMENT',
  baseUrl: null,
  timeoutMs: 1000,
  credentials: {},
};

describe('AdapterRegistry', () => {
  it('registers only safe adapters by default (no real external types)', () => {
    expect(defaultAdapterRegistry.has('mock')).toBe(true);
    expect(defaultAdapterRegistry.has('noop')).toBe(true);
    // Real external adapter types are intentionally NOT registered in Phase 4.
    expect(defaultAdapterRegistry.has('http')).toBe(false);
    expect(defaultAdapterRegistry.has('firebase-admin')).toBe(false);
    expect(defaultAdapterRegistry.get(null)).toBeUndefined();
  });

  it('resolves a registered adapter', () => {
    const reg = new AdapterRegistry();
    const mock = new MockAdapter();
    reg.register(mock);
    expect(reg.get('mock')).toBe(mock);
  });
});

describe('MockAdapter (no network under any behavior)', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  it('validates successfully and advertises capabilities', async () => {
    const mock = new MockAdapter();
    await expect(mock.validateConnection(ctx)).resolves.toMatchObject({ detail: expect.any(String) });
    expect(mock.describeCapabilities()).toContain('connection.validate');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('simulates a non-retryable failure', async () => {
    const mock = new MockAdapter({ behavior: 'fail' });
    await expect(mock.validateConnection(ctx)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('simulates transient (retryable) failures then succeeds', async () => {
    const mock = new MockAdapter({ behavior: 'flaky', failuresBeforeSuccess: 1 });
    await expect(mock.validateConnection(ctx)).rejects.toMatchObject({ retryable: true });
    await expect(mock.validateConnection(ctx)).resolves.toBeDefined();
  });
});

describe('NoopAdapter', () => {
  it('advertises no capabilities and rejects connection as not supported', async () => {
    const noop = new NoopAdapter();
    expect(noop.describeCapabilities()).toEqual([]);
    await expect(noop.validateConnection(ctx)).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});
