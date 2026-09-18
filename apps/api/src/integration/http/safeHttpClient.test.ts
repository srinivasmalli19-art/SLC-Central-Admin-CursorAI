import { describe, expect, it, vi } from 'vitest';

import {
  SafeHttpClient,
  buildOutboundHeaders,
  createPinnedLookup,
  type ResolveHost,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './safeHttpClient.js';

const PUBLIC_IP = '93.184.216.34';
const PUBLIC_IP2 = '8.8.8.8';
const PRIVATE_IP = '10.0.0.5';

type Handler = (req: TransportRequest) => TransportResponse | Promise<TransportResponse>;

function build(opts: {
  resolveHost?: ResolveHost;
  handler?: Handler;
  maxRedirects?: number;
  maxBytes?: number;
  allowlist?: string[];
}) {
  const handler: Handler =
    opts.handler ?? (() => ({ status: 200, locationHeader: null, bodyText: '{"ok":true}' }));
  const transport = vi.fn<Transport>(async (req) => handler(req));
  const c = new SafeHttpClient({
    allowlist: opts.allowlist ?? ['api.example.com'],
    resolveHost: opts.resolveHost ?? (async () => [PUBLIC_IP]),
    transport,
    maxRedirects: opts.maxRedirects,
    maxBytes: opts.maxBytes,
  });
  return { c, transport };
}

const req = (url: string, timeoutMs = 1000) =>
  ({ method: 'GET', url, timeoutMs, correlationId: 'cid-1' }) as const;

describe('createPinnedLookup', () => {
  it('always returns the pinned IP (single-address form)', () => {
    const lookup = createPinnedLookup(PUBLIC_IP, 4);
    const cb = vi.fn();
    (lookup as unknown as (h: string, o: unknown, c: unknown) => void)('anything.example', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, PUBLIC_IP, 4);
  });

  it('returns the pinned IP in all-addresses form when options.all is set', () => {
    const lookup = createPinnedLookup(PUBLIC_IP, 4);
    const cb = vi.fn();
    (lookup as unknown as (h: string, o: unknown, c: unknown) => void)('x', { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: PUBLIC_IP, family: 4 }]);
  });
});

describe('buildOutboundHeaders — Host header ownership', () => {
  it('forces the intended Host and ignores a caller-supplied host (any casing)', () => {
    const out = buildOutboundHeaders(
      { accept: 'application/json', Host: 'evil.internal', authorization: 'Bearer x' },
      'api.example.com',
    );
    expect(out.host).toBe('api.example.com');
    // No leftover attacker-controlled host header of any casing.
    expect(out.Host).toBeUndefined();
    expect(Object.keys(out).filter((k) => k.toLowerCase() === 'host')).toEqual(['host']);
    expect(out.authorization).toBe('Bearer x');
  });
});

describe('SafeHttpClient — pinned destination', () => {
  it('Case A: resolves to a public IP and connects to that same validated IP', async () => {
    const { c, transport } = build({});
    const res = await c.request(req('https://api.example.com/health'));
    expect(res.status).toBe(200);
    const tr = transport.mock.calls[0][0];
    expect(tr.pinnedIp).toBe(PUBLIC_IP);
    expect(tr.hostname).toBe('api.example.com');
    expect(tr.pinnedFamily).toBe(4);
    expect(tr.headers['x-correlation-id']).toBe('cid-1');
  });

  it('Case B: the connection is pinned to the validated IP (a later differing resolution cannot rebind)', async () => {
    // A "malicious" resolver: first answer allowed, any later answer private.
    let calls = 0;
    const resolveHost: ResolveHost = async () => {
      calls += 1;
      return calls === 1 ? [PUBLIC_IP] : [PRIVATE_IP];
    };
    const { c, transport } = build({ resolveHost });
    await c.request(req('https://api.example.com/x'));
    // Exactly one resolution for the single hop, and the transport was pinned to
    // the validated public IP — no second (rebinding) resolution reaches it.
    expect(calls).toBe(1);
    expect(transport.mock.calls[0][0].pinnedIp).toBe(PUBLIC_IP);
  });

  it('pins the first validated address when multiple are returned', async () => {
    const { c, transport } = build({ resolveHost: async () => [PUBLIC_IP2, PUBLIC_IP] });
    await c.request(req('https://api.example.com/x'));
    expect(transport.mock.calls[0][0].pinnedIp).toBe(PUBLIC_IP2);
  });

  it('fails closed when one of several resolved IPs is blocked (ambiguous)', async () => {
    const { c, transport } = build({ resolveHost: async () => [PUBLIC_IP2, PRIVATE_IP] });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects when all resolved IPs are blocked', async () => {
    const { c, transport } = build({ resolveHost: async () => [PRIVATE_IP] });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed on an empty DNS result', async () => {
    const { c, transport } = build({ resolveHost: async () => [] });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('supports IPv6 and rejects IPv4-mapped private addresses', async () => {
    const v6 = build({ resolveHost: async () => ['2606:2800:220:1:248:1893:25c8:1946'] });
    await v6.c.request(req('https://api.example.com/x'));
    expect(v6.transport.mock.calls[0][0].pinnedFamily).toBe(6);

    const mappedPublic = build({ resolveHost: async () => ['::ffff:93.184.216.34'] });
    await expect(mappedPublic.c.request(req('https://api.example.com/x'))).resolves.toBeDefined();

    const mappedPrivate = build({ resolveHost: async () => ['::ffff:10.0.0.1'] });
    await expect(mappedPrivate.c.request(req('https://api.example.com/x'))).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('rejects a non-allow-listed host without resolving or connecting', async () => {
    const resolveHost = vi.fn<ResolveHost>(async () => [PUBLIC_IP]);
    const { c, transport } = build({ resolveHost, allowlist: ['other.example.com'] });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(resolveHost).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('SafeHttpClient — redirects (per-hop revalidation)', () => {
  it('follows an allow-listed redirect and re-resolves/re-pins each hop', async () => {
    const resolveHost = vi.fn<ResolveHost>(async () => [PUBLIC_IP]);
    let hop = 0;
    const { c, transport } = build({
      resolveHost,
      handler: () => {
        hop += 1;
        return hop === 1
          ? { status: 302, locationHeader: 'https://api.example.com/final', bodyText: '' }
          : { status: 200, locationHeader: null, bodyText: '{"ok":"final"}' };
      },
    });
    const res = await c.request(req('https://api.example.com/start'));
    expect(res.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(resolveHost).toHaveBeenCalledTimes(2); // each hop re-resolved
  });

  it('blocks a redirect to a non-allow-listed host', async () => {
    const { c } = build({
      handler: () => ({ status: 302, locationHeader: 'https://evil.example.net/steal', bodyText: '' }),
    });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('blocks a redirect to a host that resolves to a private IP (redirect rebinding)', async () => {
    const resolveHost: ResolveHost = async (host) =>
      host === 'api.example.com' ? [PUBLIC_IP] : [PRIVATE_IP];
    const { c } = build({
      resolveHost,
      allowlist: ['api.example.com', 'internal.example.com'],
      handler: (r) =>
        r.hostname === 'api.example.com'
          ? { status: 302, locationHeader: 'https://internal.example.com/x', bodyText: '' }
          : { status: 200, locationHeader: null, bodyText: '{}' },
    });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('enforces a maximum redirect count', async () => {
    const { c } = build({
      maxRedirects: 2,
      handler: () => ({ status: 302, locationHeader: 'https://api.example.com/loop', bodyText: '' }),
    });
    await expect(c.request(req('https://api.example.com/x'))).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('SafeHttpClient — timeout, size, error safety', () => {
  it('maps aborts to TIMEOUT', async () => {
    const handler: Handler = (r) =>
      new Promise<TransportResponse>((_res, rej) =>
        r.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        }),
      );
    const { c } = build({ handler });
    await expect(c.request(req('https://api.example.com/slow', 10))).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('enforces a maximum response size', async () => {
    const { c } = build({ maxBytes: 10, handler: () => ({ status: 200, locationHeader: null, bodyText: 'x'.repeat(50) }) });
    await expect(c.request(req('https://api.example.com/big'))).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  it('does not leak the target host/URL in error messages', async () => {
    const { c } = build({
      handler: () => ({ status: 302, locationHeader: 'https://secret-internal.example.net/x', bodyText: '' }),
    });
    try {
      await c.request(req('https://api.example.com/x'));
      throw new Error('expected rejection');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-internal.example.net');
    }
  });
});
