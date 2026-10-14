/**
 * Central identity management against an in-memory Keycloak Admin API:
 * listing apps and admins, inviting, per-app roles, disable + sign out, and the
 * Super Admin safeguards. The database is an in-memory fake.
 */
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@slc/shared';

import { createFakePrisma } from '../../../test/fakePrisma.js';
import { startFakeKeycloak, type FakeKeycloak } from '../../../test/fakeKeycloakAdmin.js';
import { hashToken } from '../../lib/tokens.js';

const fake = vi.hoisted(() => ({ prisma: undefined as unknown }));
vi.mock('../../db/prisma.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../db/prisma.js')>();
  return { ...original, requirePrisma: () => fake.prisma, getPrisma: () => fake.prisma };
});

const APP_ROLES = {
  'central-admin': ['SUPER_ADMIN', 'APP_ADMIN', 'SUPPORT_ADMIN', 'REPORT_VIEWER'],
  'pasumithra-admin': ['super_admin', 'moderator', 'viewer'],
  'stock-admin': ['super_admin', 'manager', 'viewer'],
};

let kc: FakeKeycloak;
let app: Express;
let db: ReturnType<typeof createFakePrisma>;
const CSRF = 'csrf-token';

async function signedIn(roles: string[], email: string, oidcSubject?: string) {
  const { token } = await db.seedAdminWithSession({ email, roles, oidcSubject }, hashToken);
  return { cookie: `slc_admin_session=${token}; slc_csrf=${CSRF}` };
}

beforeAll(async () => {
  kc = await startFakeKeycloak(APP_ROLES, { 'slc-super-admins': { 'central-admin': ['SUPER_ADMIN'] } });
  process.env.KEYCLOAK_BASE_URL = kc.baseUrl;
  process.env.KEYCLOAK_REALM = kc.realm;
  process.env.KEYCLOAK_ADMIN_CLIENT_ID = kc.clientId;
  process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = kc.clientSecret;
  process.env.KEYCLOAK_MANAGED_APPS = 'central-admin=SLC Central Admin,pasumithra-admin=Pasumithra,stock-admin=Stock Management,jeevamitra-admin=JeevaMitra';
  const { createApp } = await import('../../app.js');
  app = createApp();
});

beforeEach(() => {
  db = createFakePrisma(ROLE_KEYS, ROLE_PERMISSIONS);
  fake.prisma = db.prisma;
  kc.users.length = 0;
  kc.emailsSent.length = 0;
  kc.smtpWorks = true;
});

afterAll(async () => {
  await kc.close();
  for (const key of ['KEYCLOAK_BASE_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'KEYCLOAK_MANAGED_APPS']) {
    delete process.env[key];
  }
});

describe('central identity management', () => {
  it('lists managed apps with their roles and skips apps missing in Keycloak', async () => {
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app).get('/api/v1/identity/apps').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.apps).toEqual([
      { clientId: 'central-admin', name: 'SLC Central Admin', roles: ['APP_ADMIN', 'REPORT_VIEWER', 'SUPER_ADMIN', 'SUPPORT_ADMIN'] },
      { clientId: 'pasumithra-admin', name: 'Pasumithra', roles: ['moderator', 'super_admin', 'viewer'] },
      { clientId: 'stock-admin', name: 'Stock Management', roles: ['manager', 'super_admin', 'viewer'] },
    ]);
  });

  it('requires admin_users.view to list and admin_users.manage to change', async () => {
    const viewer = await signedIn(['REPORT_VIEWER'], 'reports@slc.test');
    expect((await request(app).get('/api/v1/identity/users').set('Cookie', viewer.cookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/identity/users')).status).toBe(401);
  });

  it('lists admins with per-app roles, groups and MFA status', async () => {
    kc.addUser({ email: 'ravi@slc.test', roles: { 'pasumithra-admin': ['moderator'], 'stock-admin': ['viewer'] } });
    kc.addUser({ email: 'chief@slc.test', groups: ['slc-super-admins'], otp: false });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');

    const res = await request(app).get('/api/v1/identity/users').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const [ravi, chief] = res.body.data.users;
    expect(ravi).toMatchObject({
      email: 'ravi@slc.test',
      enabled: true,
      mfaEnrolled: true,
      appRoles: { 'pasumithra-admin': ['moderator'], 'stock-admin': ['viewer'] },
      groups: [],
    });
    expect(chief).toMatchObject({ email: 'chief@slc.test', mfaEnrolled: false, groups: ['/slc-super-admins'] });
  });

  it('finds admins by any part of their email (Keycloak search is prefix-only by default)', async () => {
    kc.addUser({ email: 'ravi.kumar@slc.test' });
    kc.addUser({ email: 'anitha@partner.example' });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');

    const middle = await request(app).get('/api/v1/identity/users?search=slc.test').set('Cookie', cookie);
    expect(middle.body.data.users.map((u: { email: string }) => u.email)).toEqual(['ravi.kumar@slc.test']);

    const sneaky = await request(app).get('/api/v1/identity/users?search=*').set('Cookie', cookie);
    expect(sneaky.body.data.users).toHaveLength(2);
  });

  it('invites an admin with per-app roles and emails the set-password + MFA link', async () => {
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app)
      .post('/api/v1/identity/users')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ email: 'New.Person@SLC.test', firstName: 'New', appRoles: { 'pasumithra-admin': ['viewer'], 'stock-admin': ['manager'] } });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ invitationEmailSent: true, invitationEmailEnabled: true });
    expect(res.body.data.user).toMatchObject({
      email: 'new.person@slc.test',
      pendingActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'VERIFY_EMAIL'],
      appRoles: { 'pasumithra-admin': ['viewer'], 'stock-admin': ['manager'] },
    });
    expect(kc.emailsSent[0]!.actions).toEqual(['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'VERIFY_EMAIL']);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'IDENTITY_USER_INVITED', actorEmail: 'boss@slc.test' });
  });

  it('still creates the account when the invitation email cannot be sent', async () => {
    kc.smtpWorks = false;
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app)
      .post('/api/v1/identity/users')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ email: 'nosmtp@slc.test', appRoles: { 'stock-admin': ['viewer'] } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ invitationEmailSent: false, invitationEmailEnabled: true });
  });

  it('rejects unknown apps and roles before creating anything', async () => {
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const badRole = await request(app)
      .post('/api/v1/identity/users')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ email: 'x@slc.test', appRoles: { 'stock-admin': ['owner'] } });
    expect(badRole.status).toBe(422);
    const badApp = await request(app)
      .post('/api/v1/identity/users')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ email: 'x@slc.test', appRoles: { 'not-an-app': ['viewer'] } });
    expect(badApp.status).toBe(422);
    expect(kc.users).toHaveLength(0);
  });

  it('replaces the roles of the listed apps only', async () => {
    const ravi = kc.addUser({ email: 'ravi@slc.test', roles: { 'pasumithra-admin': ['moderator'], 'stock-admin': ['viewer'] } });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app)
      .put(`/api/v1/identity/users/${ravi.id}/roles`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'pasumithra-admin': ['viewer'] } });
    expect(res.status).toBe(200);
    expect(res.body.data.user.appRoles).toEqual({ 'pasumithra-admin': ['viewer'], 'stock-admin': ['viewer'] });
    expect(db.state.auditLogs.at(-1)).toMatchObject({
      action: 'IDENTITY_ROLES_CHANGED',
      metadata: { added: ['pasumithra-admin:viewer'], removed: ['pasumithra-admin:moderator'] },
    });
  });

  it('only lets a Super Admin grant Super Admin or touch an existing one', async () => {
    // An access manager: may manage admins but is not a Super Admin (no system.manage).
    db = createFakePrisma(ROLE_KEYS, {
      ...ROLE_PERMISSIONS,
      APP_ADMIN: [...ROLE_PERMISSIONS.APP_ADMIN, 'admin_users.view', 'admin_users.manage'],
    });
    fake.prisma = db.prisma;
    const ravi = kc.addUser({ email: 'ravi@slc.test', roles: { 'stock-admin': ['viewer'] } });
    const chief = kc.addUser({ email: 'chief@slc.test', roles: { 'central-admin': ['SUPER_ADMIN'] } });
    kc.addUser({ email: 'chief2@slc.test', roles: { 'central-admin': ['SUPER_ADMIN'] } });
    const { cookie } = await signedIn(['APP_ADMIN'], 'manager@slc.test');
    const send = (method: 'put' | 'patch', path: string, body: object) =>
      request(app)[method](`/api/v1/identity/users/${path}`).set('Cookie', cookie).set('X-CSRF-Token', CSRF).send(body);

    // Allowed: ordinary per-app role change.
    expect((await send('put', `${ravi.id}/roles`, { appRoles: { 'pasumithra-admin': ['moderator'] } })).status).toBe(200);
    // Refused: granting Super Admin, editing a Super Admin, disabling a Super Admin.
    expect((await send('put', `${ravi.id}/roles`, { appRoles: { 'central-admin': ['SUPER_ADMIN'] } })).status).toBe(403);
    expect((await send('put', `${chief.id}/roles`, { appRoles: { 'stock-admin': ['viewer'] } })).status).toBe(403);
    expect((await send('patch', `${chief.id}/status`, { enabled: false })).status).toBe(403);
    expect(kc.users.find((u) => u.id === chief.id)!.enabled).toBe(true);

    // A plain SUPPORT_ADMIN cannot manage admins at all.
    const support = await signedIn(['SUPPORT_ADMIN'], 'support@slc.test');
    const denied = await request(app)
      .put(`/api/v1/identity/users/${ravi.id}/roles`)
      .set('Cookie', support.cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'stock-admin': ['manager'] } });
    expect(denied.status).toBe(403);
  });

  it('refuses to demote or disable the last Super Admin, and refuses self-disable', async () => {
    const only = kc.addUser({ email: 'only@slc.test', roles: { 'central-admin': ['SUPER_ADMIN'] } });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test', 'boss-subject');

    const demote = await request(app)
      .put(`/api/v1/identity/users/${only.id}/roles`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'central-admin': ['APP_ADMIN'] } });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_SUPER_ADMIN');

    const disable = await request(app)
      .patch(`/api/v1/identity/users/${only.id}/status`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ enabled: false });
    expect(disable.status).toBe(409);

    // Once a second Super Admin exists (through a group), demotion is allowed.
    kc.addUser({ email: 'chief@slc.test', groups: ['slc-super-admins'] });
    const ok = await request(app)
      .put(`/api/v1/identity/users/${only.id}/roles`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'central-admin': ['APP_ADMIN'] } });
    expect(ok.status).toBe(200);

    const self = kc.addUser({ email: 'boss@slc.test', roles: { 'stock-admin': ['viewer'] } });
    db.state.users.find((u) => u.email === 'boss@slc.test')!.oidcSubject = self.id;
    const selfDisable = await request(app)
      .patch(`/api/v1/identity/users/${self.id}/status`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ enabled: false });
    expect(selfDisable.status).toBe(409);
    expect(selfDisable.body.error.code).toBe('SELF_DISABLE');
  });

  it('disabling ends the person\'s sessions in Keycloak and in Central Admin', async () => {
    const ravi = kc.addUser({ email: 'ravi@slc.test', roles: { 'central-admin': ['SUPPORT_ADMIN'] } });
    const raviSession = await signedIn(['SUPPORT_ADMIN'], 'ravi@slc.test', ravi.id);
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');

    expect((await request(app).get('/api/v1/auth/me').set('Cookie', raviSession.cookie)).status).toBe(200);
    const res = await request(app)
      .patch(`/api/v1/identity/users/${ravi.id}/status`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.user.enabled).toBe(false);
    expect(kc.users.find((u) => u.id === ravi.id)!.sessions).toBe(0);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', raviSession.cookie)).status).toBe(401);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'IDENTITY_USER_DISABLED', metadata: { localSessionsRevoked: 1 } });
  });

  it('signs a person out everywhere without disabling them', async () => {
    const ravi = kc.addUser({ email: 'ravi@slc.test', roles: { 'stock-admin': ['viewer'] } });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app)
      .post(`/api/v1/identity/users/${ravi.id}/logout`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF);
    expect(res.status).toBe(200);
    expect(kc.users[0]!.sessions).toBe(0);
    expect(kc.users[0]!.enabled).toBe(true);
  });

  it('treats a group Super Admin as a Super Admin and blocks editing your own access', async () => {
    db = createFakePrisma(ROLE_KEYS, {
      ...ROLE_PERMISSIONS,
      APP_ADMIN: [...ROLE_PERMISSIONS.APP_ADMIN, 'admin_users.view', 'admin_users.manage'],
    });
    fake.prisma = db.prisma;
    const groupSuper = kc.addUser({ email: 'chief@slc.test', groups: ['slc-super-admins'] });
    const me = kc.addUser({ email: 'manager@slc.test', roles: { 'stock-admin': ['viewer'] } });
    const { cookie } = await signedIn(['APP_ADMIN'], 'manager@slc.test', me.id);
    const put = (id: string, appRoles: object) =>
      request(app).put(`/api/v1/identity/users/${id}/roles`).set('Cookie', cookie).set('X-CSRF-Token', CSRF).send({ appRoles });

    expect((await put(groupSuper.id, { 'stock-admin': ['viewer'] })).status).toBe(403);
    const self = await put(me.id, { 'pasumithra-admin': ['super_admin'] });
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/own access/);
  });

  it('removing a role ends that person\'s Central Admin sessions right away', async () => {
    const ravi = kc.addUser({ email: 'ravi@slc.test', roles: { 'central-admin': ['SUPPORT_ADMIN'], 'stock-admin': ['manager'] } });
    const raviSession = await signedIn(['SUPPORT_ADMIN'], 'ravi@slc.test', ravi.id);
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');

    // Adding a role does not sign them out.
    await request(app).put(`/api/v1/identity/users/${ravi.id}/roles`).set('Cookie', cookie).set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'pasumithra-admin': ['viewer'] } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', raviSession.cookie)).status).toBe(200);

    // Removing one does.
    const res = await request(app).put(`/api/v1/identity/users/${ravi.id}/roles`).set('Cookie', cookie).set('X-CSRF-Token', CSRF)
      .send({ appRoles: { 'stock-admin': [] } });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', raviSession.cookie)).status).toBe(401);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'IDENTITY_ROLES_CHANGED', metadata: { localSessionsRevoked: 1 } });
  });

  it('requires the CSRF token for changes', async () => {
    const ravi = kc.addUser({ email: 'ravi@slc.test' });
    const { cookie } = await signedIn(['SUPER_ADMIN'], 'boss@slc.test');
    const res = await request(app).post(`/api/v1/identity/users/${ravi.id}/logout`).set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
