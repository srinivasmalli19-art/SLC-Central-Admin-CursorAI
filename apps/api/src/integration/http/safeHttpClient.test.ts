import { afterEach, describe, expect, it, vi } from 'vitest';

import { SafeHttpClient, type FetchImpl, type ResolveHost } from './safeHttpClient.js';

const ALLOW = ['api.example.com'];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function client(opts: {
  resolveHost?: ResolveHost;
  fetchImpl?: FetchImpl;
  maxRedirects?: number;
  maxBytes?: number;
  allowlist?: string[];
}) {
  return new SafeHttpClient({
    allowlist: opts.allowlist ?? ALLOW,
    resolveHost: opts.resolveHost ?? (async () => ['93.184.216.34']),
    fetchImpl: opts.fetchImpl ?? (async () => jsonResponse(200, { ok: true })),
    maxRedirects: opts.maxRedirects,
    maxBytes: opts.maxBytes,
  });
}

const req = (url: string) =>
  ({ method: 'GET', url, timeoutMs: 1000, correlationId: 'cid-1' }) as const;

describe('SafeHttpClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('performs an allow-listed request to a public IP and propagates the correlation id', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(200, { ok: true }));
    const c = client({ fetchImpl });
    const res = await c.request(req('https://api.example.com/health'));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.bodyText)).toEqual({ ok: true });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-correlation-id']).toBe('cid-1');
  });

  it('rejects a non-allow-listed host without fetching', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(200, {}));
    const c = client({ fetchImpl, allowlist: ['other.example.com'] });
    await expect(c.request(req('https://api.example.com/health'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks DNS rebinding: allow-listed host resolving to a private IP', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(200, {}));
    const c = client({ fetchImpl, resolveHost: async () => ['169.254.169.254'] });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks loopback / link-local resolutions', async () => {
    const c1 = client({ resolveHost: async () => ['127.0.0.1'] });
    await expect(c1.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    const c2 = client({ resolveHost: async () => ['fe80::1'] });
    await expect(c2.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('re-validates redirect destinations and blocks a redirect to a disallowed host', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(302, '', { location: 'https://evil.example.net/steal' }),
    );
    const c = client({ fetchImpl });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('follows an allow-listed redirect and re-validates it', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(jsonResponse(302, '', { location: 'https://api.example.com/final' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 'final' }));
    const c = client({ fetchImpl });
    const res = await c.request(req('https://api.example.com/start'));
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('enforces a maximum redirect count', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(302, '', { location: 'https://api.example.com/loop' }),
    );
    const c = client({ fetchImpl, maxRedirects: 2 });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  it('maps aborts to TIMEOUT', async () => {
    const fetchImpl: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const c = client({ fetchImpl });
    await expect(
      c.request({ method: 'GET', url: 'https://api.example.com/slow', timeoutMs: 10, correlationId: 'x' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('enforces a maximum response size', async () => {
    const big = 'x'.repeat(50);
    const c = client({ fetchImpl: async () => jsonResponse(200, big), maxBytes: 10 });
    await expect(c.request(req('https://api.example.com/big'))).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('never triggers a real network call (global fetch not used when injected)', async () => {
    const realFetch = vi.spyOn(globalThis, 'fetch');
    const c = client({ fetchImpl: async () => jsonResponse(200, { ok: true }) });
    await c.request(req('https://api.example.com/health'));
    expect(realFetch).not.toHaveBeenCalled();
  });
});
