import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
import { AdapterRegistry } from '../../integration/adapter/registry.js';
import { MockAdapter } from '../../integration/adapter/mockAdapter.js';
import { FakeCredentialResolver } from '../../integration/credentials/resolver.js';
import { IntegrationService } from '../../integration/integration.service.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const app = createApp();
const password = 'Sup3r-Secret-Pass!';

async function createApplication(slug: string, name: string): Promise<string> {
  const prisma = requirePrisma();
  const row = await prisma.application.create({ data: { slug, name } });
  return row.id;
}

d('integration management API (integration)', () => {
  let appAdmin: Authed; // integrations.view/manage/test
  let viewer: Authed; // no integrations.view
  let viewOnly: Authed; // integrations.view only (custom role)
  let appId: string;
  let appBId: string;

  beforeAll(async () => {
    await resetDb();
    const prisma = requirePrisma();
    await prisma.application.deleteMany({});

    appId = await createApplication('integ-app', 'Integration App');
    appBId = await createApplication('integ-app-b', 'Integration App B');

    await createAdmin({ email: 'iappadmin@slc.test', password, roleKeys: ['APP_ADMIN'] });
    await createAdmin({ email: 'iviewer@slc.test', password, roleKeys: ['REPORT_VIEWER'] });
    await createCustomRole('TEST_INTEG_VIEW', ['integrations.view']);
    await createAdmin({ email: 'iviewonly@slc.test', password, roleKeys: [] });
    const mgr = await prisma.adminUser.findUniqueOrThrow({ where: { email: 'iviewonly@slc.test' } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'TEST_INTEG_VIEW' } });
    await prisma.adminUserRole.create({ data: { adminUserId: mgr.id, roleId: role.id } });

    appAdmin = await loginAgent(app, 'iappadmin@slc.test', password);
    viewer = await loginAgent(app, 'iviewer@slc.test', password);
    viewOnly = await loginAgent(app, 'iviewonly@slc.test', password);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await request(app).get(`${API}/applications/${appId}/integrations`);
    expect(res.status).toBe(401);
  });

  it('allows integrations.view to list (200)', async () => {
    const res = await appAdmin.agent.get(`${API}/applications/${appId}/integrations`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.integrations)).toBe(true);
  });

  it('denies listing without integrations.view (403)', async () => {
    const res = await viewer.agent.get(`${API}/applications/${appId}/integrations`);
    expect(res.status).toBe(403);
  });

  it('requires CSRF for configuration mutations (403 without token)', async () => {
    const res = await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .send({ adapterType: 'mock', enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('allows integrations.manage to configure (200) and derives CONFIGURED status', async () => {
    const res = await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ adapterType: 'mock', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.integration.connectionStatus).toBe('CONFIGURED');
  });

  it('denies configuration to integrations.view-only (403)', async () => {
    const res = await viewOnly.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', viewOnly.csrf)
      .send({ adapterType: 'mock', enabled: true });
    expect(res.status).toBe(403);
  });

  it('never accepts a client-supplied connectionStatus (authority is system-only)', async () => {
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/STAGING`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ adapterType: 'mock', enabled: true, connectionStatus: 'CONNECTED' });
    const res = await appAdmin.agent.get(`${API}/applications/${appId}/integrations/STAGING`);
    expect(res.body.data.integration.connectionStatus).not.toBe('CONNECTED');
    expect(res.body.data.integration.connectionStatus).toBe('CONFIGURED');
  });

  it('stores credential REFERENCES only (never a secret value)', async () => {
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({
        adapterType: 'mock',
        enabled: true,
        credentialReferences: [
          { name: 'api_token', refKey: 'DEV_TOKEN', environment: 'DEVELOPMENT', scopes: ['read'] },
        ],
      });
    const res = await appAdmin.agent.get(`${API}/applications/${appId}/integrations/DEVELOPMENT`);
    const ref = res.body.data.integration.credentialReferences[0];
    expect(ref.refKey).toBe('DEV_TOKEN');
    expect('value' in ref).toBe(false);
    expect('secret' in ref).toBe(false);
    // Whole response must not contain any secret-looking material.
    expect(JSON.stringify(res.body)).not.toContain('DEV_TOKEN=');
  });

  it('resolves capabilities from the configured adapter', async () => {
    const res = await appAdmin.agent.get(
      `${API}/applications/${appId}/integrations/DEVELOPMENT/capabilities`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.capabilities).toContain('connection.validate');
  });

  it('reaches CONNECTED only via a system test with the safe mock adapter', async () => {
    // Reconfigure DEVELOPMENT with no credential refs so the mock connects cleanly.
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ adapterType: 'mock', enabled: true, credentialReferences: [] });
    const res = await appAdmin.agent
      .post(`${API}/applications/${appId}/integrations/DEVELOPMENT/test`)
      .set('X-CSRF-Token', appAdmin.csrf);
    expect(res.status).toBe(200);
    expect(res.body.data.result.ok).toBe(true);
    expect(res.body.data.result.connectionStatus).toBe('CONNECTED');
  });

  it('denies connection test without integrations.test (403)', async () => {
    const res = await viewOnly.agent
      .post(`${API}/applications/${appId}/integrations/DEVELOPMENT/test`)
      .set('X-CSRF-Token', viewOnly.csrf);
    expect(res.status).toBe(403);
  });

  it('enforces the kill switch: a disabled integration is not operated', async () => {
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ enabled: false });
    const res = await appAdmin.agent
      .post(`${API}/applications/${appId}/integrations/DEVELOPMENT/test`)
      .set('X-CSRF-Token', appAdmin.csrf);
    expect(res.body.data.result.ok).toBe(false);
    expect(res.body.data.result.code).toBe('CONFIG_INVALID');
  });

  it('returns NOT_APPLICABLE when no adapter is registered for the type (real external types)', async () => {
    // Configure on DEVELOPMENT so the Phase 5A runtime-environment gate (test
    // runtime = DEVELOPMENT) passes and we reach the unregistered-adapter check.
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({ adapterType: 'http', enabled: true });
    const res = await appAdmin.agent
      .post(`${API}/applications/${appId}/integrations/DEVELOPMENT/test`)
      .set('X-CSRF-Token', appAdmin.csrf);
    expect(res.body.data.result.ok).toBe(false);
    expect(res.body.data.result.code).toBe('NOT_SUPPORTED');
    expect(res.body.data.result.connectionStatus).toBe('NOT_APPLICABLE');
  });

  it('enforces environment isolation: a dev runtime cannot resolve production credentials', async () => {
    await appAdmin.agent
      .put(`${API}/applications/${appId}/integrations/PRODUCTION`)
      .set('X-CSRF-Token', appAdmin.csrf)
      .send({
        adapterType: 'mock',
        enabled: true,
        credentialReferences: [
          { name: 'prod_token', refKey: 'PROD_TOKEN', environment: 'PRODUCTION' },
        ],
      });
    const res = await appAdmin.agent
      .post(`${API}/applications/${appId}/integrations/PRODUCTION/test`)
      .set('X-CSRF-Token', appAdmin.csrf);
    expect(res.body.data.result.ok).toBe(false);
    expect(res.body.data.result.code).toBe('ENVIRONMENT_MISMATCH');
    expect(res.body.data.result.connectionStatus).toBe('DISCONNECTED');
  });

  it('isolates integrations per application', async () => {
    const resB = await appAdmin.agent.get(`${API}/applications/${appBId}/integrations`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.integrations).toHaveLength(0); // app B has none
    const resA = await appAdmin.agent.get(`${API}/applications/${appId}/integrations`);
    expect(resA.body.data.integrations.length).toBeGreaterThan(0);
  });

  it('makes NO external network calls across configure + test', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await appAdmin.agent
        .put(`${API}/applications/${appId}/integrations/DEVELOPMENT`)
        .set('X-CSRF-Token', appAdmin.csrf)
        .send({ adapterType: 'mock', enabled: true, credentialReferences: [] });
      await appAdmin.agent
        .post(`${API}/applications/${appId}/integrations/DEVELOPMENT/test`)
        .set('X-CSRF-Token', appAdmin.csrf);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

d('IntegrationService failure policies + secret handling (service-level)', () => {
  const password2 = 'Sup3r-Secret-Pass!';
  let appId: string;

  beforeAll(async () => {
    const prisma = requirePrisma();
    await prisma.application.deleteMany({ where: { slug: { startsWith: 'svc-' } } });
    appId = await createApplication('svc-app', 'Service App');
    void password2;
  });

  function serviceWith(adapter: MockAdapter, values: Record<string, string> = {}): IntegrationService {
    const registry = new AdapterRegistry();
    registry.register(adapter);
    return new IntegrationService({
      registry,
      resolver: new FakeCredentialResolver(values),
      runtimeEnv: 'DEVELOPMENT',
      retry: { retries: 2, baseDelayMs: 0, jitter: false, sleep: async () => {} },
    });
  }

  async function configure(svc: IntegrationService, env: 'DEVELOPMENT', timeoutMs?: number) {
    await svc.configureIntegration(appId, env, { adapterType: 'mock', enabled: true, timeoutMs, credentialReferences: [] });
  }

  it('retries a transient failure and reaches CONNECTED', async () => {
    const svc = serviceWith(new MockAdapter({ behavior: 'flaky', failuresBeforeSuccess: 1 }));
    await configure(svc, 'DEVELOPMENT');
    const result = await svc.testConnection(appId, 'DEVELOPMENT');
    expect(result.ok).toBe(true);
    expect(result.connectionStatus).toBe('CONNECTED');
  });

  it('times out a hanging adapter and marks DEGRADED', async () => {
    const svc = serviceWith(new MockAdapter({ behavior: 'timeout' }));
    await configure(svc, 'DEVELOPMENT', 20);
    const result = await svc.testConnection(appId, 'DEVELOPMENT');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
    expect(result.connectionStatus).toBe('DEGRADED');
  });

  it('marks DISCONNECTED on a non-retryable failure', async () => {
    const svc = serviceWith(new MockAdapter({ behavior: 'fail' }));
    await configure(svc, 'DEVELOPMENT');
    const result = await svc.testConnection(appId, 'DEVELOPMENT');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
    expect(result.connectionStatus).toBe('DISCONNECTED');
  });

  it('never persists or exposes a resolved secret value', async () => {
    const secret = 'ULTRA-SECRET-VALUE-123';
    const svc = serviceWith(new MockAdapter({ behavior: 'ok' }), { DEV_TOKEN: secret });
    await svc.configureIntegration(appId, 'DEVELOPMENT', {
      adapterType: 'mock',
      enabled: true,
      credentialReferences: [{ name: 'api_token', refKey: 'DEV_TOKEN', environment: 'DEVELOPMENT' }],
    });
    const result = await svc.testConnection(appId, 'DEVELOPMENT');
    expect(result.ok).toBe(true);

    const prisma = requirePrisma();
    const integration = await prisma.applicationIntegration.findFirstOrThrow({
      where: { applicationId: appId, environment: 'DEVELOPMENT' },
      include: { credentialReferences: true, events: true },
    });
    const serialized = JSON.stringify(integration);
    expect(serialized).not.toContain(secret);
  });
});
