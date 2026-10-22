/**
 * Pasunestam administration from Central Admin. Access is decided by the
 * admin's SLC role for `pasunestam-admin` (editor / manager).
 */
import { generateKeyPairSync } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@slc/shared';

import { createFakePrisma } from '../../../../test/fakePrisma.js';
import { hashToken } from '../../../lib/tokens.js';
import type {
  CancelResult,
  PasunestamStore,
  PnCase,
  PnCertificate,
  PnScheme,
  PnTemplate,
  PnVet,
} from './pasunestam.store.js';

const fake = vi.hoisted(() => ({ prisma: undefined as unknown }));
vi.mock('../../../db/prisma.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../db/prisma.js')>();
  return { ...original, requirePrisma: () => fake.prisma, getPrisma: () => fake.prisma };
});

let app: Express;
let db: ReturnType<typeof createFakePrisma>;
const CSRF = 'csrf';

// ---- in-memory Pasunestam ------------------------------------------------------
const pn = {
  cases: [] as PnCase[],
  certificates: [] as PnCertificate[],
  vets: [] as PnVet[],
  templates: [] as PnTemplate[],
  schemes: [] as PnScheme[],
  disabled: new Set<string>(),
};

const memoryStore: PasunestamStore = {
  async summary() {
    return {
      vets: pn.vets.length,
      staff: 0,
      certificatesIssued: pn.certificates.filter((c) => c.status === 'issued').length,
      certificatesCancelled: pn.certificates.filter((c) => c.status === 'cancelled').length,
      certificatesDraft: pn.certificates.filter((c) => c.status === 'draft').length,
      casesAwaitingReview: pn.cases.filter((c) => c.status === 'submitted').length,
      casesPublished: pn.cases.filter((c) => c.status === 'published').length,
      templates: pn.templates.length,
      templatesPublished: pn.templates.filter((t) => t.published).length,
      schemes: pn.schemes.length,
      schemeApplications: 1,
    };
  },
  async listCases({ status, limit }) {
    return pn.cases.filter((c) => c.status === status).slice(0, limit);
  },
  async setCaseStatus(id, status, reviewer) {
    const c = pn.cases.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, { status, reviewedBy: reviewer, reviewedAt: '2026-10-14T00:00:00.000Z' });
    return { ...c };
  },
  async findCertificates({ number, status, limit }) {
    return pn.certificates.filter((c) => (!number || c.number === number) && (!status || c.status === status)).slice(0, limit);
  },
  async cancelCertificate(id, reason): Promise<CancelResult> {
    const c = pn.certificates.find((x) => x.id === id);
    if (!c) return { outcome: 'not_found' };
    if (c.status !== 'issued') return { outcome: 'not_issued', status: c.status };
    Object.assign(c, { status: 'cancelled', cancelledReason: reason, cancelledAt: 'now' });
    return { outcome: 'cancelled', certificate: { ...c } };
  },
  async listVets({ limit }) {
    return { items: pn.vets.slice(0, limit).map((v) => ({ ...v, disabled: pn.disabled.has(v.uid) })), nextCursor: null };
  },
  async getVet(uid) {
    return pn.vets.find((v) => v.uid === uid) ?? null;
  },
  async setAccountDisabled(uid, disabled) {
    if (disabled) pn.disabled.add(uid);
    else pn.disabled.delete(uid);
  },
  async listTemplates() {
    return pn.templates.map((t) => ({ ...t }));
  },
  async setTemplatePublished(id, published) {
    const t = pn.templates.find((x) => x.id === id);
    if (!t) return null;
    t.published = published;
    return { ...t };
  },
  async listSchemes() {
    return pn.schemes.map((s) => ({ ...s }));
  },
  async deleteScheme(id) {
    const index = pn.schemes.findIndex((s) => s.id === id);
    if (index < 0) return null;
    return pn.schemes.splice(index, 1)[0]!;
  },
  async listSchemeApplications() {
    return [{ id: 'app1', schemeId: 's1', applicantName: 'Ramaiah', mobile: '98480 00000', village: 'Tenali', animalCount: '4', createdBy: 'v1', createdAt: null }];
  },
};

async function signedIn(appRoles: Record<string, string[]>) {
  const { token, adminId } = await db.seedAdminWithSession({ email: 'staff@slc.test', roles: ['SUPPORT_ADMIN'] }, hashToken);
  (db.state.users.find((u) => u.id === adminId) as unknown as { appRoles: unknown }).appRoles = appRoles;
  return `slc_admin_session=${token}; slc_csrf=${CSRF}`;
}
const post = (path: string, cookie: string, body: object) =>
  request(app).post(`/api/v1/apps/pasunestam${path}`).set('Cookie', cookie).set('X-CSRF-Token', CSRF).send(body);
const get = (path: string, cookie: string) => request(app).get(`/api/v1/apps/pasunestam${path}`).set('Cookie', cookie);

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SA_PASUNESTAM = JSON.stringify({
    project_id: 'pasunestam-test',
    client_email: 'svc@pasunestam-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  process.env.FIREBASE_BRIDGE_APPS = JSON.stringify([{ clientId: 'pasunestam-admin', serviceAccountEnv: 'FIREBASE_SA_PASUNESTAM' }]);
  process.env.OIDC_ISSUER_URL = 'http://127.0.0.1:1/realms/slc';
  process.env.OIDC_CLIENT_ID = 'central-admin';
  process.env.OIDC_CLIENT_SECRET = 'x';
  process.env.PASSWORD_LOGIN_ENABLED = 'true';
  const { setPasunestamStore } = await import('./pasunestam.routes.js');
  setPasunestamStore(memoryStore);
  const { createApp } = await import('../../../app.js');
  app = createApp();
});

beforeEach(() => {
  db = createFakePrisma(ROLE_KEYS, ROLE_PERMISSIONS);
  fake.prisma = db.prisma;
  pn.cases = [
    { id: 'c1', title: 'Bloat in a buffalo', species: 'Buffalo', body: 'History…', submitterName: 'Dr Lakshmi, VH Tenali', submittedBy: 'v1', status: 'submitted', createdAt: null, reviewedAt: null, reviewedBy: null },
  ];
  pn.certificates = [
    { id: 'cert1', number: 'HC-2026-0001', status: 'issued', templateId: 't1', vetName: 'Dr Lakshmi', vetInstitution: 'VH Tenali', vetDistrict: 'Guntur', issuedAt: null, createdAt: null, cancelledReason: null, cancelledAt: null },
    { id: 'cert2', number: null, status: 'draft', templateId: 't1', vetName: null, vetInstitution: null, vetDistrict: null, issuedAt: null, createdAt: null, cancelledReason: null, cancelledAt: null },
  ];
  pn.vets = [{ uid: 'v1', fullName: 'Dr Lakshmi', designation: 'VAS', registrationNo: 'AP-123', institution: 'VH Tenali', district: 'Guntur', createdAt: null, email: 'l@x.in', disabled: false }];
  pn.templates = [{ id: 't1', key: 'health', name: 'Health Certificate', numberPrefix: 'HC', published: true }];
  pn.schemes = [{ id: 's1', name: 'Pashu Kisan form', tag: 'Credit', description: '', fileName: 'form.pdf', fileUrl: null, createdBy: 'v1', createdAt: null }];
  pn.disabled.clear();
});

afterAll(() => {
  for (const key of ['FIREBASE_SA_PASUNESTAM', 'FIREBASE_BRIDGE_APPS', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PASSWORD_LOGIN_ENABLED']) {
    delete process.env[key];
  }
});

describe('Pasunestam from Central Admin', () => {
  it('needs a pasunestam-admin role; other apps’ roles and Central Admin roles are not enough', async () => {
    for (const roles of [{}, { 'jeevamitra-admin': ['super_admin'] }, { 'pasunestam-admin': ['viewer'] }]) {
      const cookie = await signedIn(roles);
      expect((await get('/summary', cookie)).status).toBe(403);
    }
  });

  it('editor sees the overview and the cases waiting for review', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['editor'] });
    const summary = await get('/summary', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ casesAwaitingReview: 1, certificatesIssued: 1, vets: 1 });
    const cases = await get('/cases', cookie);
    expect(cases.body.data.cases.map((c: PnCase) => c.id)).toEqual(['c1']);
  });

  it('editor publishes a case; it is audited and records who reviewed it', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['editor'] });
    const res = await post('/cases/c1/review', cookie, { decision: 'published' });
    expect(res.status).toBe(200);
    expect(pn.cases[0]).toMatchObject({ status: 'published', reviewedBy: 'SLC Central Admin: staff@slc.test' });
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'PASUNESTAM_CASE_PUBLISHED', targetId: 'c1' });
    expect((await post('/cases/missing/review', cookie, { decision: 'rejected' })).status).toBe(404);
    expect((await post('/cases/c1/review', cookie, { decision: 'submitted' })).status).toBe(422);
  });

  it('editor finds a certificate by number and cancels it with a reason; drafts cannot be cancelled', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['editor'] });
    const found = await get('/certificates?number=HC-2026-0001', cookie);
    expect(found.body.data.certificates.map((c: PnCertificate) => c.id)).toEqual(['cert1']);

    expect((await post('/certificates/cert1/cancel', cookie, { reason: '' })).status).toBe(422);
    const cancelled = await post('/certificates/cert1/cancel', cookie, { reason: 'Issued with wrong tag number' });
    expect(cancelled.status).toBe(200);
    expect(pn.certificates[0]).toMatchObject({ status: 'cancelled', cancelledReason: 'Issued with wrong tag number' });
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'PASUNESTAM_CERTIFICATE_CANCELLED', targetId: 'cert1' });

    const again = await post('/certificates/cert1/cancel', cookie, { reason: 'twice' });
    expect(again.status).toBe(409);
    expect((await post('/certificates/cert2/cancel', cookie, { reason: 'draft one' })).status).toBe(409);
  });

  it('editor cannot see vets or scheme applications, publish templates or remove schemes', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['editor'] });
    expect((await get('/vets', cookie)).status).toBe(403);
    expect((await get('/scheme-applications', cookie)).status).toBe(403);
    expect((await post('/templates/t1/published', cookie, { published: false })).status).toBe(403);
    expect((await request(app).delete('/api/v1/apps/pasunestam/schemes/s1').set('Cookie', cookie).set('X-CSRF-Token', CSRF)).status).toBe(403);
    expect((await post('/vets/v1/account', cookie, { disabled: true })).status).toBe(403);
  });

  it('manager manages vets, templates, schemes and sees applications; every change is audited', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['manager'] });
    const vets = await get('/vets', cookie);
    expect(vets.body.data.items[0]).toMatchObject({ uid: 'v1', disabled: false });

    expect((await post('/vets/v1/account', cookie, { disabled: true })).status).toBe(200);
    expect(pn.disabled.has('v1')).toBe(true);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'PASUNESTAM_VET_DISABLED', targetId: 'v1' });

    expect((await post('/templates/t1/published', cookie, { published: false })).status).toBe(200);
    expect(pn.templates[0]!.published).toBe(false);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'PASUNESTAM_TEMPLATE_UNPUBLISHED' });

    const removed = await request(app).delete('/api/v1/apps/pasunestam/schemes/s1').set('Cookie', cookie).set('X-CSRF-Token', CSRF);
    expect(removed.status).toBe(200);
    expect(pn.schemes).toHaveLength(0);
    expect(db.state.auditLogs.at(-1)).toMatchObject({ action: 'PASUNESTAM_SCHEME_REMOVED', targetId: 's1' });

    const applications = await get('/scheme-applications', cookie);
    expect(applications.body.data.applications[0]).toMatchObject({ applicantName: 'Ramaiah' });
  });

  it('never touches SLC staff accounts or unknown vets', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['manager'] });
    expect((await post('/vets/slc:abc/account', cookie, { disabled: true })).status).toBe(422);
    expect((await post('/vets/nobody/account', cookie, { disabled: true })).status).toBe(404);
    expect(pn.disabled.size).toBe(0);
  });

  it('changes need the CSRF token', async () => {
    const cookie = await signedIn({ 'pasunestam-admin': ['manager'] });
    const res = await request(app).post('/api/v1/apps/pasunestam/cases/c1/review').set('Cookie', cookie).send({ decision: 'published' });
    expect(res.status).toBe(403);
    expect(pn.cases[0]!.status).toBe('submitted');
  });
});

describe('Pasunestam data mapping', () => {
  it('reads documents as the Pasunestam app writes them', async () => {
    const { toCase, toCertificate } = await import('./pasunestam.store.js');
    expect(toCase('c', { title: 'T', status: 'weird', createdAt: '2026-01-01' })).toMatchObject({ status: 'submitted', createdAt: '2026-01-01' });
    const cert = toCertificate('x', {
      number: 'HC-1',
      status: 'issued',
      templateId: 't',
      vet: { fullName: 'Dr A', institution: 'VH', district: 'Krishna' },
      issuedAt: { toDate: () => new Date('2026-02-03T00:00:00Z') },
    });
    expect(cert).toMatchObject({ number: 'HC-1', vetName: 'Dr A', vetDistrict: 'Krishna', issuedAt: '2026-02-03T00:00:00.000Z' });
    expect(toCertificate('y', {}).status).toBe('draft');
  });

  it('only deletes scheme files inside the schemes/ folder of a Storage bucket', async () => {
    const { storageLocation } = await import('./pasunestam.store.js');
    expect(storageLocation('https://storage.googleapis.com/pasunestam.appspot.com/schemes/1-form.pdf')).toEqual({
      bucket: 'pasunestam.appspot.com',
      path: 'schemes/1-form.pdf',
    });
    expect(storageLocation('https://storage.googleapis.com/b/other/file.pdf')).toBeNull();
    expect(storageLocation('https://evil.example/schemes/x')).toBeNull();
    expect(storageLocation(null)).toBeNull();
  });
});
