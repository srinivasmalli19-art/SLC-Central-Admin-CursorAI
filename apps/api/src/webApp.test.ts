import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

function fakeWebBuild(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'slc-web-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  return dir;
}

describe('serving the web app from the API (one address on Render)', () => {
  const app = createApp({ webDistDir: fakeWebBuild() });

  it('serves index.html at / and for client-side routes', async () => {
    for (const url of ['/', '/admin-access', '/apps/pasunestam']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets with a long cache life', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('a missing asset is a 404, not index.html', async () => {
    const res = await request(app).get('/assets/missing.js');
    expect(res.status).toBe(404);
  });

  it('API routes still answer as the API, and unknown API paths stay JSON 404s', async () => {
    const health = await request(app).get('/api/v1/health');
    expect(health.body.ok).toBe(true);
    const missing = await request(app).get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json');
  });

  it('refuses to start when the folder has no built web app', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'slc-empty-'));
    expect(() => createApp({ webDistDir: empty })).toThrow(/no index.html/);
  });

  it('without a web folder, / is the API 404 as before', async () => {
    const res = await request(createApp({ webDistDir: null })).get('/');
    expect(res.status).toBe(404);
  });
});

describe('addresses on Render', () => {
  it('uses RENDER_EXTERNAL_URL for the web and API address unless set explicitly', () => {
    const base = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const onRender = loadConfig({ ...base, RENDER_EXTERNAL_URL: 'https://slcvet-admin.onrender.com' });
    expect(onRender.webBaseUrl).toBe('https://slcvet-admin.onrender.com');
    expect(onRender.apiBaseUrl).toBe('https://slcvet-admin.onrender.com');
    expect(onRender.corsOrigins).toEqual(['https://slcvet-admin.onrender.com']);

    const explicit = loadConfig({
      ...base,
      RENDER_EXTERNAL_URL: 'https://slcvet-admin.onrender.com',
      WEB_BASE_URL: 'https://admin.slcvet.com',
    });
    expect(explicit.webBaseUrl).toBe('https://admin.slcvet.com');
  });
});
