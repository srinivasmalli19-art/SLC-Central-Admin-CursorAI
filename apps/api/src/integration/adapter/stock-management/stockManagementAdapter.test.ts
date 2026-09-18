import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SafeHttpClient,
  type ResolveHost,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '../../http/safeHttpClient.js';
import type { AdapterContext } from '../types.js';
import { StockManagementAdapter } from './stockManagementAdapter.js';

const HOST = 'stock.example.test';
const BASE = `https://${HOST}`;
const PUBLIC_IP = '93.184.216.34';

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    correlationId: 'cid-1',
    environment: 'DEVELOPMENT',
    baseUrl: BASE,
    timeoutMs: 1000,
    credentials: {},
    ...over,
  };
}

type RouteResult = { status: number; body?: unknown; location?: string | null };
type Router = (req: TransportRequest) => RouteResult | Promise<RouteResult>;

function toResponse(out: RouteResult): TransportResponse {
  return {
    status: out.status,
    locationHeader: out.location ?? null,
    bodyText: typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}),
  };
}

/** Build an adapter whose SafeHttpClient uses an injected pinned transport (no network). */
function buildAdapter(
  router: Router,
  opts: { resolveHost?: ResolveHost; allowlist?: string[] } = {},
) {
  const transport: Transport = async (r) => toResponse(await router(r));
  const http = new SafeHttpClient({
    allowlist: opts.allowlist ?? [HOST],
    resolveHost: opts.resolveHost ?? (async () => [PUBLIC_IP]),
    transport,
  });
  return new StockManagementAdapter(http);
}

const healthBody = () => ({ status: 'ok', timestamp: 'now', env: 'test' });
const monitoringBody = () => ({
  success: true,
  data: { overview: { totalOrgs: 3, activeOrgs: 2, totalUsers: 10, activeUsers30d: 5, auditEvents24h: 4 } },
  message: 'ok',
});

describe('StockManagementAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('advertises only read capabilities (no writes)', () => {
    const adapter = buildAdapter(() => ({ status: 200, body: healthBody() }));
    const caps = adapter.describeCapabilities();
    expect(caps).toEqual(
      expect.arrayContaining(['connection.validate', 'application.statistics', 'users.list', 'application.info']),
    );
    expect(caps).not.toContain('users.disable');
    expect(caps).not.toContain('users.enable');
  });

  it('validateConnection succeeds against /health', async () => {
    const adapter = buildAdapter((r) =>
      r.url.endsWith('/health') ? { status: 200, body: healthBody() } : { status: 404, body: {} },
    );
    await expect(adapter.validateConnection(ctx())).resolves.toMatchObject({ detail: 'health:ok' });
  });

  it('getStatistics validates and returns monitoring data', async () => {
    const adapter = buildAdapter(() => ({ status: 200, body: monitoringBody() }));
    const stats = await adapter.getStatistics(ctx({ credentials: { api_token: { value: 't', scopes: [] } } }));
    expect((stats.overview as { totalOrgs: number }).totalOrgs).toBe(3);
  });

  it('getUsers preserves organisation identifiers and does not merge orgs', async () => {
    const usersBody = {
      success: true,
      data: [
        { id: 'u1', name: 'A', email: 'a@x', role: 'Engineer', isActive: true, orgId: 'org-1' },
        { id: 'u2', name: 'B', email: 'b@x', role: 'Admin', isActive: false, orgId: 'org-1' },
        { id: 'u3', name: 'C', email: 'c@x', role: 'Store_Manager', isActive: true, orgId: 'org-2' },
      ],
      pagination: { total: 3, page: 1, limit: 50, totalPages: 1 },
    };
    const adapter = buildAdapter(() => ({ status: 200, body: usersBody }));
    const users = await adapter.getUsers(ctx({ credentials: { api_token: { value: 't', scopes: [] } } }));
    expect(users).toHaveLength(3);
    expect(users.map((u) => u.orgId)).toEqual(['org-1', 'org-1', 'org-2']);
    expect(new Set(users.map((u) => u.orgId))).toEqual(new Set(['org-1', 'org-2']));
  });

  it('getApplicationInfo returns organisations', async () => {
    const orgsBody = {
      success: true,
      data: [{ id: 'org-1', name: 'Site A', siteCode: 'A1', isActive: true }],
    };
    const adapter = buildAdapter(() => ({ status: 200, body: orgsBody }));
    const info = await adapter.getApplicationInfo(ctx({ credentials: { api_token: { value: 't', scopes: [] } } }));
    expect(info.organisations as unknown[]).toHaveLength(1);
  });

  it.each([
    [403, 'FORBIDDEN', false],
    [404, 'NOT_FOUND', false],
    [429, 'RATE_LIMITED', true],
    [500, 'UPSTREAM_5XX', true],
  ])('maps HTTP %s to %s (retryable=%s)', async (status, code, retryable) => {
    const adapter = buildAdapter(() => ({ status: status as number, body: { success: false, message: 'x' } }));
    try {
      await adapter.getStatistics(ctx({ credentials: { api_token: { value: 't', scopes: [] } } }));
      throw new Error('expected error');
    } catch (err) {
      expect((err as { code: string }).code).toBe(code);
      expect((err as { retryable: boolean }).retryable).toBe(retryable);
    }
  });

  it('maps 401 to UNAUTHORIZED with a single bounded re-auth (no unlimited retries)', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 401, locationHeader: null, bodyText: '{"success":false}' }));
    const http = new SafeHttpClient({ allowlist: [HOST], resolveHost: async () => [PUBLIC_IP], transport });
    const adapter = new StockManagementAdapter(http);
    await expect(
      adapter.getStatistics(ctx({ credentials: { api_token: { value: 't', scopes: [] } } })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    expect(transport).toHaveBeenCalledTimes(2); // attempt0 + one bounded re-auth
  });

  it('maps invalid JSON and schema mismatches to MALFORMED_RESPONSE', async () => {
    const badJson = buildAdapter(() => ({ status: 200, body: 'not-json{' }));
    await expect(badJson.validateConnection(ctx())).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    const badSchema = buildAdapter(() => ({ status: 200, body: { unexpected: true } }));
    await expect(badSchema.validateConnection(ctx())).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  it('maps timeouts to TIMEOUT', async () => {
    const transport: Transport = (r) =>
      new Promise<TransportResponse>((_res, rej) =>
        r.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        }),
      );
    const http = new SafeHttpClient({ allowlist: [HOST], resolveHost: async () => [PUBLIC_IP], transport });
    const adapter = new StockManagementAdapter(http);
    await expect(adapter.validateConnection(ctx({ timeoutMs: 10 }))).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('blocks a non-allow-listed base URL (SSRF)', async () => {
    const adapter = buildAdapter(() => ({ status: 200, body: healthBody() }), { allowlist: ['other.example.test'] });
    await expect(adapter.validateConnection(ctx())).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('blocks DNS rebinding to a private resolved IP (SSRF)', async () => {
    const adapter = buildAdapter(() => ({ status: 200, body: healthBody() }), { resolveHost: async () => ['10.0.0.5'] });
    await expect(adapter.validateConnection(ctx())).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('propagates a correlation id and attaches the bearer token', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, locationHeader: null, bodyText: JSON.stringify(monitoringBody()) }));
    const http = new SafeHttpClient({ allowlist: [HOST], resolveHost: async () => [PUBLIC_IP], transport });
    const adapter = new StockManagementAdapter(http);
    await adapter.getStatistics(ctx({ credentials: { api_token: { value: 'secret-token', scopes: [] } } }));
    const headers = transport.mock.calls[0][0].headers;
    expect(headers['x-correlation-id']).toBe('cid-1');
    expect(headers.authorization).toBe('Bearer secret-token');
  });

  it('password-login provider logs in (no refresh storm) and never leaks the password', async () => {
    const seen: string[] = [];
    const transport = vi.fn<Transport>(async (r) => {
      seen.push(r.url);
      if (r.url.endsWith('/api/auth/login')) {
        return { status: 200, locationHeader: null, bodyText: JSON.stringify({ data: { accessToken: 'jwt-123' } }) };
      }
      return { status: 200, locationHeader: null, bodyText: JSON.stringify(monitoringBody()) };
    });
    const http = new SafeHttpClient({ allowlist: [HOST], resolveHost: async () => [PUBLIC_IP], transport });
    const adapter = new StockManagementAdapter(http);
    const c = ctx({ credentials: { email: { value: 'svc@x', scopes: [] }, password: { value: 'p@ss', scopes: [] } } });
    await adapter.getStatistics(c);
    await adapter.getStatistics(c);
    expect(seen.filter((u) => u.endsWith('/api/auth/login')).length).toBeLessThanOrEqual(2);
    const monitoringCall = transport.mock.calls.find((cx) => cx[0].url.endsWith('/api/monitoring'));
    expect(JSON.stringify(monitoringCall?.[0] ?? {})).not.toContain('p@ss');
  });
});

describe('Stock Management adapter static safety guard', () => {
  it('does not import or use unrestricted network clients directly', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = ['stockManagementAdapter.ts', 'auth.ts', 'schemas.ts'];
    const forbidden = [
      /\bfetch\s*\(/,
      /from ['"]axios['"]/,
      /from ['"]undici['"]/,
      /require\(['"](http|https|axios|undici|node:http|node:https)['"]\)/,
      /(?<![.\w])https?\.request\s*\(/,
    ];
    for (const file of files) {
      const src = readFileSync(path.join(dir, file), 'utf8');
      for (const re of forbidden) {
        expect(re.test(src), `${file} must not match ${re}`).toBe(false);
      }
    }
  });
});
