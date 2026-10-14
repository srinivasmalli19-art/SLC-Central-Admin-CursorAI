/**
 * App management from Central Admin: JeevaMitra (Firebase) and NearSip
 * (Supabase). Access is decided by the admin's SLC role for each app.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@slc/shared';

import { createFakePrisma } from '../../../test/fakePrisma.js';
import { hashToken } from '../../lib/tokens.js';
import type { JeevaMitraStore, JmAlert, JmUser } from './jeevamitra/jeevamitra.store.js';

const fake = vi.hoisted(() => ({ prisma: undefined as unknown }));
vi.mock('../../db/prisma.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../db/prisma.js')>();
  return { ...original, requirePrisma: () => fake.prisma, getPrisma: () => fake.prisma };
});

let app: Express;
let db: ReturnType<typeof createFakePrisma>;
let supabase: http.Server;
const CSRF = 'csrf';

// ---- in-memory JeevaMitra ----------------------------------------------------
const jm = {
  users: [] as JmUser[],
  vetProfiles: [] as { id: string; ownerId: string; isVerified: boolean }[],
  disabled: new Set<string>(),
  alerts: [] as JmAlert[],
};
const memoryStore: JeevaMitraStore = {
  summary: async () => ({
    users: jm.users.length,
    farmers: jm.users.filter((u) => u.role === 'farmer').length,
    shepherds: 0,
    vets: jm.users.filter((u) => u.role === 'vet').length,
    vetsAwaitingVerification: jm.users.filter((u) => u.role === 'vet' && !u.isVerified).length,
    farms: 0,
    bookings: 0,
    activeDiseaseAlerts: jm.alerts.filter((a) => a.isActive).length,
  }),
  listUsers: async (f) => ({
    items: jm.users.filter((u) => (!f.role || u.role === f.role) && (f.verified === undefined || u.isVerified === f.verified)).slice(0, f.limit),
    nextCursor: null,
  }),
  getUser: async (uid) => jm.users.find((u) => u.uid === uid) ?? null,
  setVetVerified: async (uid, verified) => {
    jm.users.find((u) => u.uid === uid)!.isVerified = verified;
    const profiles = jm.vetProfiles.filter((p) => p.ownerId === uid);
    profiles.forEach((p) => (p.isVerified = verified));
    return { vetProfilesUpdated: profiles.length };
  },
  setAccountDisabled: async (uid, disabled) => {
    if (disabled) jm.disabled.add(uid);
    else jm.disabled.delete(uid);
  },
  listAlerts: async (f) => jm.alerts.filter((a) => !f.activeOnly || a.isActive),
  setAlertActive: async (id, active) => {
    const alert = jm.alerts.find((a) => a.id === id);
    if (!alert) return false;
    alert.isActive = active;
    return true;
  },
};

// ---- fake Supabase (PostgREST + GoTrue admin) --------------------------------
const sb = {
  places: [] as Record<string, unknown>[],
  reviews: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  bans: new Map<string, string>(),
  lastAuth: '' as string,
};

function startSupabase(): Promise<string> {
  const api = express();
  api.use(express.json());
  api.use((req, res, next) => {
    sb.lastAuth = req.get('authorization') ?? '';
    if (req.get('apikey') !== 'service-role-key-for-tests') return void res.status(401).json({ message: 'bad key' });
    next();
  });
  const table = (name: 'places' | 'reviews' | 'profiles') => sb[name];
  api.head('/rest/v1/:table', (req, res) => {
    const rows = table(req.params.table as 'places');
    res.set('content-range', `*/${rows.length}`).end();
  });
  api.get('/rest/v1/:table', (req, res) => {
    let rows = [...table(req.params.table as 'places')];
    const nameFilter = typeof req.query.name === 'string' ? req.query.name : '';
    if (nameFilter.startsWith('ilike.')) {
      const term = nameFilter.slice(6).replace(/\*/g, '').toLowerCase();
      rows = rows.filter((r) => String(r.name).toLowerCase().includes(term));
    }
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 100);
    res.set('content-range', `${offset}-${offset + limit - 1}/${rows.length}`).json(rows.slice(offset, offset + limit));
  });
  api.post('/rest/v1/places', (req, res) => {
    const row = { id: String(sb.places.length + 100), ...req.body };
    sb.places.push(row);
    res.status(201).json([row]);
  });
  api.patch('/rest/v1/places', (req, res) => {
    const id = String(req.query.id).replace('eq.', '');
    const row = sb.places.find((p) => p.id === id);
    if (row) Object.assign(row, req.body);
    res.json(row ? [row] : []);
  });
  api.delete('/rest/v1/:table', (req, res) => {
    const rows = table(req.params.table as 'places');
    const id = String(req.query.id).replace('eq.', '');
    const index = rows.findIndex((r) => r.id === id);
    res.json(index >= 0 ? rows.splice(index, 1) : []);
  });
  api.put('/auth/v1/admin/users/:id', (req, res) => {
    sb.bans.set(req.params.id, req.body.ban_duration);
    res.json({ id: req.params.id });
  });
  supabase = http.createServer(api);
  return new Promise((resolve) => supabase.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(supabase.address() as AddressInfo).port}`)));
}

async function signedIn(appRoles: Record<string, string[]>) {
  const { token, adminId } = await db.seedAdminWithSession({ email: 'staff@slc.test', roles: ['SUPPORT_ADMIN'] }, hashToken);
  (db.state.users.find((u) => u.id === adminId) as unknown as { appRoles: unknown }).appRoles = appRoles;
  return `slc_admin_session=${token}; slc_csrf=${CSRF}`;
}

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SA_JEEVAMITRA = JSON.stringify({
    project_id: 'jeevamitra-test',
    client_email: 'svc@jeevamitra-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  process.env.FIREBASE_BRIDGE_APPS = JSON.stringify([{ clientId: 'jeevamitra-admin', serviceAccountEnv: 'FIREBASE_SA_JEEVAMITRA' }]);
  process.env.OIDC_ISSUER_URL = 'http://127.0.0.1:1/realms/slc';
  process.env.OIDC_CLIENT_ID = 'central-admin';
  process.env.OIDC_CLIENT_SECRET = 'x';
  process.env.PASSWORD_LOGIN_ENABLED = 'true';
  process.env.NEARSIP_SUPABASE_URL = await startSupabase();
  process.env.NEARSIP_SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
  const { setJeevaMitraStore } = await import('./jeevamitra/jeevamitra.routes.js');
  setJeevaMitraStore(memoryStore);
  const { createApp } = await import('../../app.js');
  app = createApp();
});

beforeEach(() => {
  db = createFakePrisma(ROLE_KEYS, ROLE_PERMISSIONS);
  fake.prisma = db.prisma;
  jm.users = [
    { uid: 'v1', name: 'Dr Rao', phone: '+91', role: 'vet', village: null, district: 'Guntur', isVerified: false, isProfileComplete: true },
    { uid: 'f1', name: 'Farmer', phone: '+91', role: 'farmer', village: null, district: null, isVerified: false, isProfileComplete: true },
  ];
  jm.vetProfiles = [{ id: 'vp1', ownerId: 'v1', isVerified: false }];
  jm.disabled.clear();
  jm.alerts = [
    { id: 'a1', title: 'PPR outbreak', disease: 'PPR', severity: 'high', district: 'Guntur', village: 'X', isActive: true, issuedAt: null, reportedBy: 'f1', sourceAuthority: 'community' },
  ];
  sb.places = [
    { id: '1', name: 'Chai Point', type: 'drink' },
    { id: '2', name: 'Biryani House', type: 'food' },
  ];
  sb.reviews = [{ id: 'r1', text: 'spam' }];
  sb.profiles = [{ id: 'u-1', name: 'NearSip user' }];
  sb.bans.clear();
});

afterAll(async () => {
  await new Promise<void>((resolve) => supabase.close(() => resolve()));
  for (const key of ['FIREBASE_SA_JEEVAMITRA', 'FIREBASE_BRIDGE_APPS', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PASSWORD_LOGIN_ENABLED', 'NEARSIP_SUPABASE_URL', 'NEARSIP_SUPABASE_SERVICE_ROLE_KEY']) {
    delete process.env[key];
  }
});

describe('JeevaMitra from Central Admin', () => {
  it('needs a jeevamitra-admin role (Central Admin roles alone are not enough)', async () => {
    const cookie = await signedIn({ 'stock-admin': ['admin'] });
    expect((await request(app).get('/api/v1/apps/jeevamitra/summary').set('Cookie', cookie)).status).toBe(403);
  });

  it('viewer can read but not verify', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['viewer'] });
    const summary = await request(app).get('/api/v1/apps/jeevamitra/summary').set('Cookie', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.data.vetsAwaitingVerification).toBe(1);
    const pending = await request(app).get('/api/v1/apps/jeevamitra/users?role=vet&verified=false').set('Cookie', cookie);
    expect(pending.body.data.items.map((u: JmUser) => u.uid)).toEqual(['v1']);
    const verify = await request(app)
      .post('/api/v1/apps/jeevamitra/users/v1/verification')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ verified: true });
    expect(verify.status).toBe(403);
  });

  it('admin verifies a vet on both the account and the public vet profile, and it is audited', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['admin'] });
    const res = await request(app)
      .post('/api/v1/apps/jeevamitra/users/v1/verification')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ verified: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ user: { isVerified: true }, vetProfilesUpdated: 1 });
    expect(jm.vetProfiles[0]!.isVerified).toBe(true);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_VET_VERIFIED', targetId: 'v1' });
  });

  it('refuses to verify a non-vet', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['admin'] });
    const res = await request(app)
      .post('/api/v1/apps/jeevamitra/users/f1/verification')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', CSRF)
      .send({ verified: true });
    expect(res.status).toBe(422);
  });

  it('only super_admin disables accounts; admin moderates alerts', async () => {
    const admin = await signedIn({ 'jeevamitra-admin': ['admin'] });
    const denied = await request(app)
      .post('/api/v1/apps/jeevamitra/users/f1/account')
      .set('Cookie', admin)
      .set('X-CSRF-Token', CSRF)
      .send({ disabled: true });
    expect(denied.status).toBe(403);
    const alert = await request(app)
      .post('/api/v1/apps/jeevamitra/alerts/a1/status')
      .set('Cookie', admin)
      .set('X-CSRF-Token', CSRF)
      .send({ active: false });
    expect(alert.status).toBe(200);
    expect(jm.alerts[0]!.isActive).toBe(false);

    const superAdmin = await signedIn({ 'jeevamitra-admin': ['super_admin'] });
    const ok = await request(app)
      .post('/api/v1/apps/jeevamitra/users/f1/account')
      .set('Cookie', superAdmin)
      .set('X-CSRF-Token', CSRF)
      .send({ disabled: true });
    expect(ok.status).toBe(200);
    expect(jm.disabled.has('f1')).toBe(true);
  });
});

describe('Firebase bridge scope', () => {
  it('never issues sign-in tokens for management-only apps (no browser origins)', async () => {
    const res = await request(app)
      .post('/api/v1/bridge/firebase/jeevamitra-admin/token')
      .send({ accessToken: 'x'.repeat(40) });
    expect(res.status).toBe(404);
  });
});

describe('NearSip from Central Admin', () => {
  it('reads counts and searches places with the service-role key (server side only)', async () => {
    const cookie = await signedIn({ 'nearsip-admin': ['viewer'] });
    const summary = await request(app).get('/api/v1/apps/nearsip/summary').set('Cookie', cookie);
    expect(summary.body.data).toEqual({ places: 2, reviews: 1, users: 1 });
    expect(sb.lastAuth).toBe('Bearer service-role-key-for-tests');
    const places = await request(app).get('/api/v1/apps/nearsip/places?search=chai').set('Cookie', cookie);
    expect(places.body.data).toMatchObject({ total: 1, items: [{ name: 'Chai Point' }] });
    expect(JSON.stringify(places.body)).not.toContain('service-role-key');
  });

  it('admin creates, edits and deletes places and deletes reviews; viewer cannot', async () => {
    const viewer = await signedIn({ 'nearsip-admin': ['viewer'] });
    expect(
      (await request(app).delete('/api/v1/apps/nearsip/places/1').set('Cookie', viewer).set('X-CSRF-Token', CSRF)).status,
    ).toBe(403);

    const admin = await signedIn({ 'nearsip-admin': ['admin'] });
    const created = await request(app)
      .post('/api/v1/apps/nearsip/places')
      .set('Cookie', admin)
      .set('X-CSRF-Token', CSRF)
      .send({ name: 'Juice Bar', type: 'drink', address: null, latitude: 16.3, longitude: 80.4, rating: 4.5, is_hotspot: false, is_verified: true, is_popular: false });
    expect(created.status).toBe(201);
    const edited = await request(app)
      .patch(`/api/v1/apps/nearsip/places/${created.body.data.place.id}`)
      .set('Cookie', admin)
      .set('X-CSRF-Token', CSRF)
      .send({ is_popular: true });
    expect(edited.body.data.place.is_popular).toBe(true);
    const bad = await request(app)
      .patch('/api/v1/apps/nearsip/places/1')
      .set('Cookie', admin)
      .set('X-CSRF-Token', CSRF)
      .send({ owner_id: 'someone' });
    expect(bad.status).toBe(422);
    expect((await request(app).delete('/api/v1/apps/nearsip/reviews/r1').set('Cookie', admin).set('X-CSRF-Token', CSRF)).status).toBe(200);
    expect(sb.reviews).toHaveLength(0);
    expect((await request(app).delete('/api/v1/apps/nearsip/places/999').set('Cookie', admin).set('X-CSRF-Token', CSRF)).status).toBe(404);
  });

  it('super_admin disables a user by banning (reversible)', async () => {
    const admin = await signedIn({ 'nearsip-admin': ['admin'] });
    expect(
      (await request(app).post('/api/v1/apps/nearsip/users/u-1/account').set('Cookie', admin).set('X-CSRF-Token', CSRF).send({ disabled: true })).status,
    ).toBe(403);
    const superAdmin = await signedIn({ 'nearsip-admin': ['super_admin'] });
    await request(app).post('/api/v1/apps/nearsip/users/u-1/account').set('Cookie', superAdmin).set('X-CSRF-Token', CSRF).send({ disabled: true });
    expect(sb.bans.get('u-1')).toBe('876000h');
    await request(app).post('/api/v1/apps/nearsip/users/u-1/account').set('Cookie', superAdmin).set('X-CSRF-Token', CSRF).send({ disabled: false });
    expect(sb.bans.get('u-1')).toBe('none');
  });
});
