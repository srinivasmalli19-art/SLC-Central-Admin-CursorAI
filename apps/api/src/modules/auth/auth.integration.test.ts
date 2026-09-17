import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { API, createAdmin, loginAgent, resetDb } from '../../../test/helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const app = createApp();

d('authentication (integration)', () => {
  const password = 'Sup3r-Secret-Pass!';

  beforeAll(async () => {
    await resetDb();
    await createAdmin({ email: 'active@slc.test', password, roleKeys: ['SUPER_ADMIN'] });
    await createAdmin({
      email: 'disabled@slc.test',
      password,
      roleKeys: ['REPORT_VIEWER'],
      status: 'DISABLED',
    });
  });

  it('rejects an unauthenticated request (GET /auth/me)', async () => {
    const res = await request(app).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('authenticates valid credentials and returns the current user', async () => {
    const { status, body } = await loginAgent(app, 'active@slc.test', password);
    expect(status).toBe(200);
    expect(body.data.user.email).toBe('active@slc.test');
    expect(body.data.user.roles).toContain('SUPER_ADMIN');
    expect(body.data.csrfToken).toBeTruthy();
  });

  it('allows an authenticated request after login', async () => {
    const { agent, status } = await loginAgent(app, 'active@slc.test', password);
    expect(status).toBe(200);
    const me = await agent.get(`${API}/auth/me`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('active@slc.test');
  });

  it('rejects a disabled admin at login', async () => {
    const { status, body } = await loginAgent(app, 'disabled@slc.test', password);
    expect(status).toBe(401);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects invalid credentials (wrong password and unknown user) generically', async () => {
    const wrong = await loginAgent(app, 'active@slc.test', 'not-the-password!!');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const unknown = await loginAgent(app, 'nobody@slc.test', password);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects malformed login requests with a validation error', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('invalidates the session on logout', async () => {
    const { agent, csrf } = await loginAgent(app, 'active@slc.test', password);
    const before = await agent.get(`${API}/auth/me`);
    expect(before.status).toBe(200);

    const out = await agent.post(`${API}/auth/logout`).set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);

    const after = await agent.get(`${API}/auth/me`);
    expect(after.status).toBe(401);
  });

  it('rejects an authenticated mutation without a valid CSRF token', async () => {
    const { agent } = await loginAgent(app, 'active@slc.test', password);
    const res = await agent.post(`${API}/auth/logout`); // no X-CSRF-Token header
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('rate-limits repeated login attempts', async () => {
    const email = 'ratelimit@slc.test';
    await createAdmin({ email, password, roleKeys: ['REPORT_VIEWER'] });

    let sawRateLimit = false;
    for (let i = 0; i < 15; i += 1) {
      const res = await request(app).post(`${API}/auth/login`).send({ email, password: 'wrong-password!' });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});
