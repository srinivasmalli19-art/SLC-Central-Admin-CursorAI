import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import {
  API,
  createAdmin,
  createCustomRole,
  loginAgent,
  resetDb,
  type Authed,
} from '../../../test/helpers.js';
import { requirePrisma } from '../../db/prisma.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const app = createApp();
const password = 'Sup3r-Secret-Pass!';

d('authorization / RBAC (integration)', () => {
  let root: Authed;
  let viewer: Authed;
  let rootId: string;

  beforeAll(async () => {
    await resetDb();
    rootId = await createAdmin({ email: 'root@slc.test', password, roleKeys: ['SUPER_ADMIN'] });
    await createAdmin({ email: 'viewer@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
    root = await loginAgent(app, 'root@slc.test', password);
    viewer = await loginAgent(app, 'viewer@slc.test', password);
  });

  it('SUPER_ADMIN holds all administrative permissions (can list admin users)', async () => {
    const res = await root.agent.get(`${API}/admin-users`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.adminUsers)).toBe(true);
  });

  it('permits access to a protected resource for a user WITH the permission', async () => {
    const res = await root.agent.get(`${API}/admin-users`);
    expect(res.status).toBe(200);
  });

  it('denies access to a protected resource for a user WITHOUT the permission', async () => {
    const res = await viewer.agent.get(`${API}/admin-users`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('denies administrative writes to REPORT_VIEWER', async () => {
    const res = await viewer.agent
      .post(`${API}/admin-users`)
      .set('X-CSRF-Token', viewer.csrf)
      .send({ email: 'x@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('enforces authorization on direct API calls even when unauthenticated', async () => {
    const res = await request(app)
      .post(`${API}/admin-users`)
      .send({ email: 'y@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
    expect(res.status).toBe(401);
  });

  it('allows SUPER_ADMIN to create a new (non-super) admin', async () => {
    const res = await root.agent
      .post(`${API}/admin-users`)
      .set('X-CSRF-Token', root.csrf)
      .send({ email: 'created@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
    expect(res.status).toBe(201);
    expect(res.body.data.adminUser.email).toBe('created@slc.test');
    expect(res.body.data.adminUser.roles).toEqual(['REPORT_VIEWER']);
  });

  describe('SUPER_ADMIN lifecycle safeguards', () => {
    it('refuses to disable the last active SUPER_ADMIN', async () => {
      const res = await root.agent
        .patch(`${API}/admin-users/${rootId}/status`)
        .set('X-CSRF-Token', root.csrf)
        .send({ status: 'DISABLED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
    });

    it('allows disabling a SUPER_ADMIN when another active one remains', async () => {
      const create = await root.agent
        .post(`${API}/admin-users`)
        .set('X-CSRF-Token', root.csrf)
        .send({ email: 'super2@slc.test', password, roleKeys: ['SUPER_ADMIN'] });
      expect(create.status).toBe(201);
      const super2Id = create.body.data.adminUser.id as string;

      const disable = await root.agent
        .patch(`${API}/admin-users/${super2Id}/status`)
        .set('X-CSRF-Token', root.csrf)
        .send({ status: 'DISABLED' });
      expect(disable.status).toBe(200);
      expect(disable.body.data.adminUser.status).toBe('DISABLED');
    });

    it('refuses to remove SUPER_ADMIN from the last active SUPER_ADMIN', async () => {
      const res = await root.agent
        .put(`${API}/admin-users/${rootId}/roles`)
        .set('X-CSRF-Token', root.csrf)
        .send({ roleKeys: ['APP_ADMIN'] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
    });

    it('only allows actors with system.manage to assign SUPER_ADMIN', async () => {
      // A custom role that can manage admin users but lacks system.manage.
      await createCustomRole('TEST_USER_MGR', ['admin_users.view', 'admin_users.manage']);
      await createAdmin({ email: 'mgr@slc.test', password, roleKeys: [] });
      // Attach the custom role directly.
      const prisma = requirePrisma();
      const [mgr, role] = await Promise.all([
        prisma.adminUser.findUniqueOrThrow({ where: { email: 'mgr@slc.test' } }),
        prisma.role.findUniqueOrThrow({ where: { key: 'TEST_USER_MGR' } }),
      ]);
      await prisma.adminUserRole.create({ data: { adminUserId: mgr.id, roleId: role.id } });

      const mgrAuth = await loginAgent(app, 'mgr@slc.test', password);

      // Can create a normal admin...
      const ok = await mgrAuth.agent
        .post(`${API}/admin-users`)
        .set('X-CSRF-Token', mgrAuth.csrf)
        .send({ email: 'normal@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
      expect(ok.status).toBe(201);

      // ...but cannot assign SUPER_ADMIN.
      const denied = await mgrAuth.agent
        .post(`${API}/admin-users`)
        .set('X-CSRF-Token', mgrAuth.csrf)
        .send({ email: 'evil-super@slc.test', password, roleKeys: ['SUPER_ADMIN'] });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
    });
  });
});
