import { describe, expect, it } from 'vitest';

import { EnvCredentialResolver, FakeCredentialResolver, type CredentialRefLike } from './resolver.js';

const baseRef: CredentialRefLike = {
  name: 'api_token',
  provider: 'ENV',
  refKey: 'SOME_TOKEN_VAR',
  environment: 'DEVELOPMENT',
  scopes: ['read'],
  status: 'ACTIVE',
};

describe('CredentialResolver environment/status guards', () => {
  it('rejects a credential whose environment differs from the runtime (no prod on dev)', async () => {
    const resolver = new FakeCredentialResolver({ SOME_TOKEN_VAR: 'secret' });
    const prodRef = { ...baseRef, environment: 'PRODUCTION' as const };
    await expect(resolver.resolve(prodRef, 'DEVELOPMENT')).rejects.toMatchObject({
      code: 'ENVIRONMENT_MISMATCH',
    });
  });

  it('rejects a revoked credential', async () => {
    const resolver = new FakeCredentialResolver({ SOME_TOKEN_VAR: 'secret' });
    await expect(
      resolver.resolve({ ...baseRef, status: 'REVOKED' }, 'DEVELOPMENT'),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_REVOKED' });
  });

  it('resolves a matching, active credential (value stays in memory)', async () => {
    const resolver = new FakeCredentialResolver({ SOME_TOKEN_VAR: 'secret-value' });
    const resolved = await resolver.resolve(baseRef, 'DEVELOPMENT');
    expect(resolved.value).toBe('secret-value');
    expect(resolved.scopes).toEqual(['read']);
  });

  it('reports CONFIG_INVALID when the referenced value is missing', async () => {
    const resolver = new FakeCredentialResolver({});
    await expect(resolver.resolve(baseRef, 'DEVELOPMENT')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('EnvCredentialResolver only supports the ENV provider in Phase 4', async () => {
    const resolver = new EnvCredentialResolver();
    await expect(
      resolver.resolve({ ...baseRef, provider: 'SECRETS_MANAGER' }, 'DEVELOPMENT'),
    ).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});
