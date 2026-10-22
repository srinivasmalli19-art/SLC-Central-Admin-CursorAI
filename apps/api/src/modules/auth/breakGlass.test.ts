/**
 * Break-glass password sign-in when central SSO is on: only listed accounts,
 * authenticator code required, short audited sessions.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@slc/shared';

import { createFakePrisma } from '../../../test/fakePrisma.js';
import { hashPassword } from '../../lib/password.js';
import { seal } from '../../lib/secretBox.js';
import { generateTotpSecret, timeStep, totpAt } from '../../lib/totp.js';

const fake = vi.hoisted(() => ({ prisma: undefined as unknown }));
vi.mock('../../db/prisma.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../db/prisma.js')>();
  return { ...original, requirePrisma: () => fake.prisma, getPrisma: () => fake.prisma };
});

const KEY = randomBytes(32);
const PASSWORD = 'Break-Glass-Only-2026!';
let app: Express;
let db: ReturnType<typeof createFakePrisma>;
let passwordHash: string;

function addLocalAdmin(email: string, opts: { secret?: string } = {}) {
  const now = new Date();
  const id = randomUUID();
  db.state.users.push({
    id,
    email,
    passwordHash,
    oidcSubject: null,
    name: 'Ops',
    status: 'ACTIVE',
    mfaEnabled: Boolean(opts.secret),
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...(opts.secret ? { mfaSecret: seal(opts.secret, KEY), mfaLastUsedStep: null } : {}),
  } as (typeof db.state.users)[number]);
  db.state.userRoles.push({ adminUserId: id, roleId: db.state.roles.find((r) => r.key === 'SUPER_ADMIN')!.id });
  return id;
}

const login = (body: Record<string, string>) => request(app).post('/api/v1/auth/login').send(body);
const lastAudit = () => db.state.auditLogs.at(-1) as { action: string; metadata?: Record<string, unknown> };

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  Object.assign(process.env, {
    OIDC_ISSUER_URL: 'http://127.0.0.1:1/realms/slc',
    OIDC_CLIENT_ID: 'central-admin',
    OIDC_CLIENT_SECRET: 'x',
    PASSWORD_LOGIN_ENABLED: 'true',
    PASSWORD_LOGIN_ALLOWED_EMAILS: 'ops@slc.test, ops2@slc.test, ops3@slc.test',
    PASSWORD_LOGIN_REQUIRE_MFA: 'true',
    MFA_ENCRYPTION_KEY: KEY.toString('base64'),
    BREAK_GLASS_SESSION_HOURS: '2',
  });
  const { createApp } = await import('../../app.js');
  app = createApp();
});

beforeEach(() => {
  db = createFakePrisma(ROLE_KEYS, ROLE_PERMISSIONS);
  fake.prisma = db.prisma;
});

afterAll(() => {
  for (const key of [
    'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PASSWORD_LOGIN_ENABLED',
    'PASSWORD_LOGIN_ALLOWED_EMAILS', 'PASSWORD_LOGIN_REQUIRE_MFA', 'MFA_ENCRYPTION_KEY', 'BREAK_GLASS_SESSION_HOURS',
  ]) {
    delete process.env[key];
  }
});

describe('break-glass password sign-in', () => {
  it('the login page offers SSO and the backup form', async () => {
    const res = await request(app).get('/api/v1/auth/config');
    expect(res.body.data).toMatchObject({ ssoEnabled: true, passwordLoginEnabled: true });
  });

  it('refuses a local account that is not on the break-glass list, with the generic error', async () => {
    addLocalAdmin('someone@slc.test', { secret: generateTotpSecret() });
    const res = await login({ email: 'someone@slc.test', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(lastAudit()).toMatchObject({ action: 'ADMIN_LOGIN_FAILED', metadata: { reason: 'not_a_break_glass_account' } });
  });

  it('refuses a listed account until its authenticator is enrolled', async () => {
    addLocalAdmin('ops2@slc.test');
    const res = await login({ email: 'ops2@slc.test', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('asks for the code, rejects wrong codes, then signs in for 2 hours and records it', async () => {
    const secret = generateTotpSecret();
    addLocalAdmin('ops@slc.test', { secret });

    const noCode = await login({ email: 'ops@slc.test', password: PASSWORD });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('MFA_REQUIRED');

    const current = totpAt(secret, timeStep());
    const wrong = current === '000000' ? '111111' : '000000';
    const bad = await login({ email: 'ops@slc.test', password: PASSWORD, otp: wrong });
    expect(bad.body.error.code).toBe('INVALID_CODE');

    const ok = await login({ email: 'ops@slc.test', password: PASSWORD, otp: current });
    expect(ok.status).toBe(200);
    const cookie = (ok.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('slc_admin_session='))!;
    const expires = Date.parse(/Expires=([^;]+)/.exec(cookie)![1]!);
    expect(expires - Date.now()).toBeLessThanOrEqual(2 * 3600_000 + 5_000);
    expect(expires - Date.now()).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(lastAudit()).toMatchObject({ action: 'ADMIN_BREAK_GLASS_LOGIN', metadata: { method: 'password', mfa: true } });

    // The same code cannot be used again.
    const replay = await login({ email: 'ops@slc.test', password: PASSWORD, otp: current });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_CODE');
  });

  it('a correct code does not help with a wrong password', async () => {
    const secret = generateTotpSecret();
    addLocalAdmin('ops3@slc.test', { secret });
    const res = await login({ email: 'ops3@slc.test', password: 'not-the-password!!', otp: totpAt(secret, timeStep()) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('SSO-only accounts can never use the password form', async () => {
    const { adminId } = await db.seedAdminWithSession({ email: 'ops@slc.test', roles: ['SUPER_ADMIN'], oidcSubject: 'kc-1' }, (t) => t);
    expect(db.state.users.find((u) => u.id === adminId)!.passwordHash).toBeNull();
    const res = await login({ email: 'ops@slc.test', password: PASSWORD });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('break-glass configuration in production', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x',
    COOKIE_SECURE: 'true',
    OIDC_ISSUER_URL: 'https://id.slcvet.com/realms/slc',
    OIDC_CLIENT_ID: 'central-admin',
    OIDC_CLIENT_SECRET: 's',
    PASSWORD_LOGIN_ENABLED: 'true',
  } as NodeJS.ProcessEnv;
  const key = randomBytes(32).toString('base64');

  it('requires the break-glass list, the encryption key, and MFA to stay on', async () => {
    const { loadConfig } = await import('../../config/env.js');
    expect(() => loadConfig({ ...prod, MFA_ENCRYPTION_KEY: key })).toThrow(/PASSWORD_LOGIN_ALLOWED_EMAILS/);
    expect(() => loadConfig({ ...prod, PASSWORD_LOGIN_ALLOWED_EMAILS: 'ops@slcvet.com' })).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() =>
      loadConfig({ ...prod, PASSWORD_LOGIN_ALLOWED_EMAILS: 'ops@slcvet.com', MFA_ENCRYPTION_KEY: key, PASSWORD_LOGIN_REQUIRE_MFA: 'false' }),
    ).toThrow(/must stay on/);
    expect(() => loadConfig({ ...prod, PASSWORD_LOGIN_ALLOWED_EMAILS: 'ops@slcvet.com', MFA_ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/);
    const ok = loadConfig({ ...prod, PASSWORD_LOGIN_ALLOWED_EMAILS: 'Ops@SLCvet.com', MFA_ENCRYPTION_KEY: key });
    expect(ok.breakGlass).toMatchObject({ allowedEmails: ['ops@slcvet.com'], requireMfa: true, sessionHours: 2 });
  });

  it('SSO-only production needs none of it', async () => {
    const { loadConfig } = await import('../../config/env.js');
    expect(loadConfig({ ...prod, PASSWORD_LOGIN_ENABLED: 'false' }).passwordLoginEnabled).toBe(false);
  });
});
