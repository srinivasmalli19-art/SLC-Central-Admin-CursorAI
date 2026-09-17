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
});
