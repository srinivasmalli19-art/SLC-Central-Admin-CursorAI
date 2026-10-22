import { describe, expect, it } from 'vitest';

import { loadConfig } from './env.js';

describe('configuration validation', () => {
  const base = {
    NODE_ENV: 'development',
    PORT: '4000',
    API_BASE_URL: 'http://localhost:4000',
    WEB_BASE_URL: 'http://localhost:5173',
  } as NodeJS.ProcessEnv;

  it('parses a valid environment and coerces the port to a number', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(4000);
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.isDevelopment).toBe(true);
    expect(cfg.corsOrigins).toContain('http://localhost:5173');
  });

  it('applies defaults when optional values are omitted', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.port).toBe(4000);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.nodeEnv).toBe('development');
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ ...base, PORT: 'not-a-number' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a non-URL base url', () => {
    expect(() => loadConfig({ ...base, API_BASE_URL: 'nope' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('requires DATABASE_URL in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/);
  });

  describe('central SSO (OIDC) settings', () => {
    const sso = {
      OIDC_ISSUER_URL: 'http://localhost:8080/realms/slc',
      OIDC_CLIENT_ID: 'central-admin',
      OIDC_CLIENT_SECRET: 'secret',
    };

    it('is disabled by default and keeps password login on', () => {
      const cfg = loadConfig(base);
      expect(cfg.oidc).toBeNull();
      expect(cfg.passwordLoginEnabled).toBe(true);
    });

    it('derives redirect URIs from the web origin and turns password login off by default', () => {
      const cfg = loadConfig({ ...base, ...sso });
      expect(cfg.oidc?.redirectUri).toBe('http://localhost:5173/api/v1/auth/oidc/callback');
      expect(cfg.oidc?.postLogoutRedirectUri).toBe('http://localhost:5173/login');
      expect(cfg.oidc?.rolesClaim).toBe('roles');
      expect(cfg.passwordLoginEnabled).toBe(false);
      expect(loadConfig({ ...base, ...sso, PASSWORD_LOGIN_ENABLED: 'true' }).passwordLoginEnabled).toBe(true);
    });

    it('rejects partial SSO settings', () => {
      expect(() => loadConfig({ ...base, OIDC_ISSUER_URL: sso.OIDC_ISSUER_URL })).toThrow(/must be set together/);
    });

    it('rejects disabling password login without SSO', () => {
      expect(() => loadConfig({ ...base, PASSWORD_LOGIN_ENABLED: 'false' })).toThrow(/cannot be false/);
    });

    it('requires an https issuer in production', () => {
      expect(() =>
        loadConfig({
          ...base,
          ...sso,
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://x',
          COOKIE_SECURE: 'true',
        }),
      ).toThrow(/must use https/);
    });
  });
});
