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
import { toItem, type JeevaMitraStore, type JmCropGuideEdit, type JmCropSettings, type JmKind, type JmUser, type JmVet } from './jeevamitra/jeevamitra.model.js';

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
// Raw Firestore-shaped docs per collection; rows go through the real toItem().
const jm = {
  users: [] as JmUser[],
  docs: {} as Record<JmKind, Record<string, Record<string, unknown>>>,
  crops: new Map<string, JmCropGuideEdit>(),
  settings: null as JmCropSettings | null,
  deletedFiles: 0,
};
const memoryStore: JeevaMitraStore = {
  summary: async () => ({
    users: jm.users.length, livestockOwners: jm.users.filter((u) => u.profileType === 'livestock').length, landProviders: 0, both: 0,
    lands: Object.keys(jm.docs.lands).length, bookings: 0, bookingsPending: 0, alerts: 1, vets: Object.keys(jm.docs.vets).length,
    stories: 0, videos: 0, chats: 0, fieldPosts: Object.keys(jm.docs.fieldPosts).length, fieldPostsHidden: 0, cropGuideEdits: jm.crops.size,
  }),
  listUsers: async (f) => ({ items: jm.users.filter((u) => (!f.profileType || u.profileType === f.profileType) && (!f.phone || u.phone === f.phone)).slice(0, f.limit), nextCursor: null }),
  getUser: async (uid) => jm.users.find((u) => u.uid === uid) ?? null,
  setAccountDisabled: async (uid, disabled) => {
    jm.users.find((u) => u.uid === uid)!.disabled = disabled;
  },
  listItems: async (kind, f) => ({ items: Object.entries(jm.docs[kind]).slice(0, f.limit).map(([id, d]) => toItem(kind, id, d)), nextCursor: null }),
  getItem: async (kind, id) => (jm.docs[kind][id] ? toItem(kind, id, jm.docs[kind][id]!) : null),
  setHidden: async (kind, id, hidden) => {
    const d = jm.docs[kind][id];
    if (!d) return false;
    d[kind === 'alerts' ? 'withdrawn' : 'hidden'] = hidden;
    return true;
  },
  deleteItem: async (kind, id) => {
    if (!jm.docs[kind][id]) return { deleted: false, filesDeleted: 0 };
    delete jm.docs[kind][id];
    return { deleted: true, filesDeleted: kind === 'fieldPosts' ? 2 : 0 };
  },
  getVet: async (id) => (jm.docs.vets[id] ? (jm.docs.vets[id] as unknown as JmVet) : null),
  createVet: async (vet, addedBy) => {
    jm.docs.vets.new1 = { ...vet, addedBy };
    return 'new1';
  },
  updateVet: async (id, vet) => {
    if (!jm.docs.vets[id]) return false;
    jm.docs.vets[id] = { ...jm.docs.vets[id], ...vet };
    return true;
  },
  listCropGuideEdits: async () => ({ edits: [...jm.crops.values()], settings: jm.settings }),
  saveCropGuide: async (edit) => void jm.crops.set(edit.id, edit),
  deleteCropGuide: async (id) => jm.crops.delete(id),
  saveCropSettings: async (settings) => {
    jm.settings = settings;
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
    { uid: 'f1', name: 'Rama', phone: '9876543210', profileType: 'land', village: 'Ponnur', district: 'Guntur', state: 'Andhra Pradesh', disabled: false },
    { uid: 'h1', name: 'Venkat', phone: '9123456780', profileType: 'livestock', village: null, district: null, state: null, disabled: true },
    { uid: 'gone', name: 'Old', phone: '', profileType: '', village: null, district: null, state: null, disabled: null },
  ];
  jm.docs = {
    lands: { l1: { ownerId: 'f1', title: 'Green Pasture', village: 'Ponnur', district: 'Guntur', acres: 4, price: 3000, unit: 'month' } },
    alerts: { a1: { reporterId: 'f1', reporterName: 'Rama', disease: 'PPR', severity: 'high', species: 'Goat/Sheep', village: 'X', district: 'Guntur', withdrawn: false } },
    vets: { v1: { name: 'Dr Rao', sector: 'Government', designation: 'Veterinary Officer', village: 'Ponnur', district: 'Guntur', phone: '9000000000' } },
    stories: { s1: { title: 'Dairy success', authorName: 'Sunita' } },
    videos: { w1: { title: 'Straw feeding', youtubeUrl: 'https://youtu.be/x' } },
    fieldPosts: { p1: { kind: 'residue', ownerId: 'f1', crop: 'cotton', acres: 3, village: 'Ponnur', district: 'Guntur', status: 'available', hidden: false } },
  };
  jm.crops.clear();
  jm.settings = null;
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
  const post = (cookie: string, url: string, body: unknown) => request(app).post(url).set('Cookie', cookie).set('X-CSRF-Token', CSRF).send(body as object);
  const put = (cookie: string, url: string, body: unknown) => request(app).put(url).set('Cookie', cookie).set('X-CSRF-Token', CSRF).send(body as object);
  const del = (cookie: string, url: string) => request(app).delete(url).set('Cookie', cookie).set('X-CSRF-Token', CSRF);
  const J = '/api/v1/apps/jeevamitra';
  const vet = {
    name: 'Dr Lakshmi', sector: 'Private', designation: 'Veterinary Assistant', services: ['Vaccination'], experienceYears: 5,
    languages: ['Telugu', 'Hindi'], village: 'Tenali', district: 'Guntur', phone: '9888877777', rating: 4.5, availability: 'Available tomorrow',
  };

  it('needs a jeevamitra-admin role (Central Admin roles alone are not enough)', async () => {
    const cookie = await signedIn({ 'stock-admin': ['manager'] });
    expect((await request(app).get(`${J}/summary`).set('Cookie', cookie)).status).toBe(403);
  });

  it('viewer reads summary, users, every content list and crop cards, but cannot change anything', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['viewer'] });
    const sum = await request(app).get(`${J}/summary`).set('Cookie', cookie);
    expect(sum.body.data?.lands, JSON.stringify(sum.body)).toBe(1);
    const users = await request(app).get(`${J}/users?profileType=livestock`).set('Cookie', cookie);
    expect(users.body.data.items.map((u: JmUser) => u.uid)).toEqual(['h1']);
    const byPhone = await request(app).get(`${J}/users?phone=9876543210`).set('Cookie', cookie);
    expect(byPhone.body.data.items.map((u: JmUser) => u.uid)).toEqual(['f1']);
    for (const kind of ['lands', 'alerts', 'vets', 'stories', 'videos', 'fieldPosts']) {
      const res = await request(app).get(`${J}/content/${kind}`).set('Cookie', cookie);
      expect(res.status, kind).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
    }
    const fp = await request(app).get(`${J}/content/fieldPosts`).set('Cookie', cookie);
    expect(fp.body.data.items[0]).toMatchObject({ title: 'cotton · 3 acres', ownerId: 'f1', status: 'available', hidden: false });
    const crops = await request(app).get(`${J}/crop-guides`).set('Cookie', cookie);
    expect(crops.body.data.defaults.length).toBeGreaterThanOrEqual(10);
    expect(crops.body.data.defaults[0].name).toHaveProperty('te');
    expect((await post(cookie, `${J}/content/lands/l1/visibility`, { hidden: true })).status).toBe(403);
    expect((await post(cookie, `${J}/vets`, vet)).status).toBe(403);
    expect((await request(app).get(`${J}/content/farms`).set('Cookie', cookie)).status).toBe(422);
  });

  it('manager pauses and resumes content (alerts use the app\'s withdrawn field) and it is audited', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['manager'] });
    const pause = await post(cookie, `${J}/content/lands/l1/visibility`, { hidden: true });
    expect(pause.status).toBe(200);
    expect(jm.docs.lands.l1!.hidden).toBe(true);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_CONTENT_PAUSED', targetType: 'Land', targetId: 'l1' });
    await post(cookie, `${J}/content/alerts/a1/visibility`, { hidden: true });
    expect(jm.docs.alerts.a1!.withdrawn).toBe(true);
    await post(cookie, `${J}/content/alerts/a1/visibility`, { hidden: false });
    expect(jm.docs.alerts.a1!.withdrawn).toBe(false);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_CONTENT_RESUMED' });
    expect((await post(cookie, `${J}/content/lands/nope/visibility`, { hidden: true })).status).toBe(404);
  });

  it('manager adds, edits and deletes vets, stories and videos; cannot delete user posts', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['manager'] });
    const created = await post(cookie, `${J}/vets`, vet);
    expect(created.status).toBe(201);
    expect(jm.docs.vets.new1).toMatchObject({ name: 'Dr Lakshmi', languages: ['Telugu', 'Hindi'], lat: null });
    expect((await post(cookie, `${J}/vets`, { ...vet, sector: 'Other' })).status).toBe(422);
    expect((await post(cookie, `${J}/vets`, { ...vet, phone: '12' })).status).toBe(422);
    const edited = await put(cookie, `${J}/vets/v1`, { ...vet, name: 'Dr Rao K' });
    expect(edited.status).toBe(200);
    expect(jm.docs.vets.v1!.name).toBe('Dr Rao K');
    expect((await del(cookie, `${J}/content/vets/v1`)).status).toBe(200);
    expect(jm.docs.vets.v1).toBeUndefined();
    expect((await del(cookie, `${J}/content/videos/w1`)).status).toBe(200);
    expect((await del(cookie, `${J}/content/stories/s1`)).status).toBe(200);
    const denied = await del(cookie, `${J}/content/lands/l1`);
    expect(denied.status).toBe(403);
    expect(jm.docs.lands.l1).toBeDefined();
    expect(db.state.auditLogs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['JEEVAMITRA_VET_CREATED', 'JEEVAMITRA_VET_UPDATED', 'JEEVAMITRA_CONTENT_DELETED']),
    );
  });

  it('manager edits crop safety cards in three languages, adds a crop, hides one, resets one', async () => {
    const cookie = await signedIn({ 'jeevamitra-admin': ['manager'] });
    const edit = await put(cookie, `${J}/crop-guides/cotton`, {
      risk: { en: 'Updated risk', te: 'కొత్త ప్రమాదం', hi: '' }, reviewedBy: 'Dr Rao, SVVU', reviewedOn: '2026-11-01',
    });
    expect(edit.status).toBe(200);
    expect(jm.crops.get('cotton')).toEqual({ id: 'cotton', risk: { en: 'Updated risk', te: 'కొత్త ప్రమాదం' }, reviewedBy: 'Dr Rao, SVVU', reviewedOn: '2026-11-01' });
    expect((await put(cookie, `${J}/crop-guides/millet_new`, { emoji: '🌾' })).status).toBe(422);
    expect((await put(cookie, `${J}/crop-guides/millet_new`, { name: { en: 'Foxtail millet' }, order: 50 })).status).toBe(200);
    expect((await put(cookie, `${J}/crop-guides/paddy`, { hidden: true })).status).toBe(200);
    expect((await put(cookie, `${J}/crop-guides/paddy`, { hidden: true, script: '<x>' })).status).toBe(422);
    expect((await put(cookie, `${J}/crop-guides/Bad Id`, { hidden: true })).status).toBe(422);
    expect((await del(cookie, `${J}/crop-guides/cotton`)).status).toBe(200);
    expect(jm.crops.has('cotton')).toBe(false);
    expect((await del(cookie, `${J}/crop-guides/cotton`)).status).toBe(404);
    const settings = await put(cookie, `${J}/crop-guide-settings`, { sprayWarningDays: 30, callVet: { en: 'Call 1962' } });
    expect(settings.status).toBe(200);
    expect(jm.settings).toEqual({ sprayWarningDays: 30, callVet: { en: 'Call 1962' } });
    expect((await put(cookie, `${J}/crop-guide-settings`, { sprayWarningDays: 999 })).status).toBe(422);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_CROP_SETTINGS_SAVED' });
  });

  it('only super_admin deletes user posts and disables / enables accounts', async () => {
    const manager = await signedIn({ 'jeevamitra-admin': ['manager'] });
    expect((await post(manager, `${J}/users/f1/account`, { disabled: true })).status).toBe(403);
    const superAdmin = await signedIn({ 'jeevamitra-admin': ['super_admin'] });
    const off = await post(superAdmin, `${J}/users/f1/account`, { disabled: true });
    expect(off.status).toBe(200);
    expect(jm.users[0]!.disabled).toBe(true);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_ACCOUNT_DISABLED', targetId: 'f1' });
    const on = await post(superAdmin, `${J}/users/h1/account`, { disabled: false });
    expect(on.status).toBe(200);
    expect(jm.users[1]!.disabled).toBe(false);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'JEEVAMITRA_ACCOUNT_ENABLED', targetId: 'h1' });
    expect((await post(superAdmin, `${J}/users/gone/account`, { disabled: true })).status).toBe(409);
    expect((await post(superAdmin, `${J}/users/nobody/account`, { disabled: true })).status).toBe(404);
    const removed = await del(superAdmin, `${J}/content/fieldPosts/p1`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, filesDeleted: 2 });
    expect(jm.docs.fieldPosts.p1).toBeUndefined();
    expect((await del(superAdmin, `${J}/content/lands/l1`)).status).toBe(200);
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

    const admin = await signedIn({ 'nearsip-admin': ['manager'] });
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
    const admin = await signedIn({ 'nearsip-admin': ['manager'] });
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
