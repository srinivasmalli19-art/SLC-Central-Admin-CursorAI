import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { API, createAdmin, loginAgent, resetDb, type Authed } from '../../../test/helpers.js';
import { requirePrisma } from '../../db/prisma.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const app = createApp();
const password = 'Sup3r-Secret-Pass!';

d('application registry (integration)', () => {
  let appAdmin: Authed; // applications.view + applications.manage
  let support: Authed; // applications.view, NO applications.manage
  let viewer: Authed; // no applications.view

  beforeAll(async () => {
    await resetDb();
    const prisma = requirePrisma();
    await prisma.application.deleteMany({});

    await createAdmin({ email: 'appadmin@slc.test', password, roleKeys: ['APP_ADMIN'] });
    await createAdmin({ email: 'support@slc.test', password, roleKeys: ['SUPPORT_ADMIN'] });
    await createAdmin({ email: 'viewer@slc.test', password, roleKeys: ['REPORT_VIEWER'] });

    // Deterministic fixtures for list/search/filter/pagination.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      slug: `fix-app-${i}`,
      name: `Fixture App ${String(i).padStart(2, '0')}`,
      status: (i % 2 === 0 ? 'PRODUCTION' : 'DEVELOPMENT') as const,
      integrationType: 'API' as const,
      integrationStatus: 'PLANNED' as const,
      platform: 'Web',
    }));
    await prisma.application.createMany({ data: rows });
    await prisma.application.create({
      data: {
        slug: 'search-target',
        name: 'Searchable Marker',
        description: 'zzqqxx unique marker',
        platform: 'Flutter',
        integrationType: 'REGISTRY_ONLY',
        integrationStatus: 'NOT_APPLICABLE',
        status: 'UNKNOWN',
      },
    });

    appAdmin = await loginAgent(app, 'appadmin@slc.test', password);
    support = await loginAgent(app, 'support@slc.test', password);
    viewer = await loginAgent(app, 'viewer@slc.test', password);
  });

  it('rejects an unauthenticated list request (401)', async () => {
    const res = await request(app).get(`${API}/applications`);
    expect(res.status).toBe(401);
  });

  it('allows a user with applications.view to list (200)', async () => {
    const res = await appAdmin.agent.get(`${API}/applications?pageSize=100`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(13);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('denies listing to a user without applications.view (403)', async () => {
    const res = await viewer.agent.get(`${API}/applications`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a user with applications.manage to create (201)', async () => {
    const res = await appAdmin.agent
      .post(`${API}/applications`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ slug: 'created-app', name: 'Created App', integrationType: 'API' });
    expect(res.status).toBe(201);
    expect(res.body.data.application.slug).toBe('created-app');
  });

  it('denies create to a user without applications.manage (403)', async () => {
    const res = await support.agent
      .post(`${API}/applications`)
      .set('X-CSRF-Token', support.csrf)
      .send({ slug: 'nope-app', name: 'Nope', integrationType: 'API' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns application detail (200) and 404 for a missing id', async () => {
    const list = await appAdmin.agent.get(`${API}/applications?q=search-target`);
    const id = list.body.data.items[0].id as string;
    const detail = await appAdmin.agent.get(`${API}/applications/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.application.slug).toBe('search-target');

    const missing = await appAdmin.agent.get(
      `${API}/applications/00000000-0000-0000-0000-000000000000`,
    );
    expect(missing.status).toBe(404);
  });

  it('supports search', async () => {
    const res = await appAdmin.agent.get(`${API}/applications?q=zzqqxx`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].slug).toBe('search-target');
  });

  it('supports filtering by status and integration type', async () => {
    const byStatus = await appAdmin.agent.get(`${API}/applications?status=PRODUCTION&pageSize=100`);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.data.items.every((a: { status: string }) => a.status === 'PRODUCTION')).toBe(
      true,
    );

    const byType = await appAdmin.agent.get(`${API}/applications?integrationType=REGISTRY_ONLY`);
    expect(byType.body.data.items.every((a: { integrationType: string }) => a.integrationType === 'REGISTRY_ONLY')).toBe(true);
  });

  it('supports pagination', async () => {
    const res = await appAdmin.agent.get(`${API}/applications?page=1&pageSize=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(5);
    expect(res.body.data.totalPages).toBe(Math.ceil(res.body.data.total / 5));
  });

  it('rejects a duplicate slug (409)', async () => {
    const first = await appAdmin.agent
      .post(`${API}/applications`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ slug: 'dupe-app', name: 'Dupe One' });
    expect(first.status).toBe(201);

    const second = await appAdmin.agent
      .post(`${API}/applications`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ slug: 'dupe-app', name: 'Dupe Two' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLUG_TAKEN');
  });

  it('preserves unknown metadata as null (does not fabricate)', async () => {
    const created = await appAdmin.agent
      .post(`${API}/applications`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ slug: 'sparse-app', name: 'Sparse App' });
    expect(created.status).toBe(201);
    const a = created.body.data.application;
    expect(a.backendTechnology).toBeNull();
    expect(a.databaseTechnology).toBeNull();
    expect(a.authenticationTechnology).toBeNull();
    expect(a.productionUrl).toBeNull();
    expect(a.version).toBeNull();
    // Sensible defaults, not fabricated data.
    expect(a.status).toBe('UNKNOWN');
    expect(a.integrationType).toBe('NONE');
  });

  it('does not expose destructive deletion (DELETE -> 404)', async () => {
    const list = await appAdmin.agent.get(`${API}/applications?q=search-target`);
    const id = list.body.data.items[0].id as string;
    const del = await appAdmin.agent.delete(`${API}/applications/${id}`).set('X-CSRF-Token', appAdmin.csrf);
    expect(del.status).toBe(404);
  });

  it('exposes DB-derived stats (200) and rejects unauthenticated (401)', async () => {
    const unauth = await request(app).get(`${API}/applications-stats`);
    expect(unauth.status).toBe(401);

    const res = await appAdmin.agent.get(`${API}/applications-stats`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.stats.total).toBe('number');
    expect(res.body.data.stats.total).toBeGreaterThan(0);
  });

  it('makes NO external backend calls during registry operations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await appAdmin.agent.get(`${API}/applications`);
      await appAdmin.agent.get(`${API}/applications-stats`);
      await appAdmin.agent
        .post(`${API}/applications`)
        .set('X-CSRF-Token', appAdmin.csrf)
        .send({ slug: 'no-net-app', name: 'No Net' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  afterAll(async () => {
    const prisma = requirePrisma();
    await prisma.application.deleteMany({});
  });
});
