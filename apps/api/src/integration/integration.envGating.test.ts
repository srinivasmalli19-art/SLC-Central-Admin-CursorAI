import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createApplication, resetDb } from '../../test/helpers.js';
import { AdapterRegistry } from './adapter/registry.js';
import { MockAdapter } from './adapter/mockAdapter.js';
import type { CredentialResolver } from './credentials/resolver.js';
import { IntegrationService } from './integration.service.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d('testConnection runtime-environment gating (Phase 5A)', () => {
  let appId: string;

  beforeAll(async () => {
    await resetDb();
    const { requirePrisma } = await import('../db/prisma.js');
    await requirePrisma().application.deleteMany({});
    appId = await createApplication('envgate-app', 'Env Gate App');

    // A configurator service (runtime irrelevant for writing config).
    const cfg = new IntegrationService({ runtimeEnv: 'DEVELOPMENT' });
    await cfg.configureIntegration(appId, 'DEVELOPMENT', {
      adapterType: 'mock',
      enabled: true,
      credentialReferences: [],
    });
    await cfg.configureIntegration(appId, 'STAGING', {
      adapterType: 'mock',
      enabled: true,
      credentialReferences: [{ name: 't', refKey: 'K', environment: 'STAGING' }],
    });
    await cfg.configureIntegration(appId, 'PRODUCTION', {
      adapterType: 'mock',
      enabled: true,
      credentialReferences: [{ name: 't', refKey: 'K', environment: 'PRODUCTION' }],
    });
  });

  function makeService(runtimeEnv: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION') {
    const adapter = new MockAdapter({ behavior: 'ok' });
    const validateSpy = vi.spyOn(adapter, 'validateConnection');
    const registry = new AdapterRegistry();
    registry.register(adapter);
    const resolve = vi.fn(async () => ({ value: 'x', scopes: [] }));
    const resolver: CredentialResolver = { resolve };
    const svc = new IntegrationService({
      registry,
      resolver,
      runtimeEnv,
      retry: { retries: 0, baseDelayMs: 0, jitter: false, sleep: async () => {} },
    });
    return { svc, validateSpy, resolve };
  }

  it('development runtime → development integration is ALLOWED', async () => {
    const { svc, validateSpy } = makeService('DEVELOPMENT');
    const result = await svc.testConnection(appId, 'DEVELOPMENT');
    expect(result.ok).toBe(true);
    expect(result.connectionStatus).toBe('CONNECTED');
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  it('development runtime → staging integration is REJECTED (no adapter, no credential resolution)', async () => {
    const { svc, validateSpy, resolve } = makeService('DEVELOPMENT');
    const result = await svc.testConnection(appId, 'STAGING');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ENVIRONMENT_MISMATCH');
    expect(result.connectionStatus).not.toBe('CONNECTED');
    expect(validateSpy).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('development runtime → production integration is REJECTED', async () => {
    const { svc, validateSpy, resolve } = makeService('DEVELOPMENT');
    const result = await svc.testConnection(appId, 'PRODUCTION');
    expect(result.code).toBe('ENVIRONMENT_MISMATCH');
    expect(validateSpy).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('staging runtime → production integration is REJECTED', async () => {
    const { svc, validateSpy, resolve } = makeService('STAGING');
    const result = await svc.testConnection(appId, 'PRODUCTION');
    expect(result.code).toBe('ENVIRONMENT_MISMATCH');
    expect(validateSpy).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('production runtime → production integration is ALLOWED', async () => {
    const { svc, validateSpy } = makeService('PRODUCTION');
    const result = await svc.testConnection(appId, 'PRODUCTION');
    expect(result.ok).toBe(true);
    expect(result.connectionStatus).toBe('CONNECTED');
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });
});
