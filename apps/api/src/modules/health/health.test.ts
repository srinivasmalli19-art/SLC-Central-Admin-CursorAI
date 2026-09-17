import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';

describe('application startup + health endpoint', () => {
  const app = createApp();

  it('builds the Express app without throwing', () => {
    expect(app).toBeTypeOf('function');
  });

  it('GET /api/v1/health returns a well-formed health payload', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { data } = res.body;
    expect(data.application).toBe('SLC Central Admin');
    expect(data.version).toBe('v1');
    expect(data.environment).toBe('test');
    expect(typeof data.timestamp).toBe('string');
    expect(Number.isFinite(data.uptimeSeconds)).toBe(true);
    // Database connectivity is reported honestly; overall status must be
    // consistent with it regardless of whether a test DB is configured.
    expect(['connected', 'disconnected', 'unknown']).toContain(data.dependencies.database);
    if (data.dependencies.database === 'connected') {
      expect(data.status).toBe('ok');
    } else {
      expect(data.status).toBe('degraded');
    }
  });

  it('sets secure headers via helmet', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a sanitized 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
