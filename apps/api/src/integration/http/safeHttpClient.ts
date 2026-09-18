import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { IntegrationError } from '../errors.js';
import { assertAllowedOutboundUrl, assertResolvedIpsAllowed } from '../ssrf.js';

/**
 * The single guarded outbound HTTP client. Every external adapter MUST route
 * requests through this abstraction — adapters must not use `fetch`,
 * `http/https.request`, `axios`, or raw `undici` directly.
 *
 * DNS-rebinding safety (the important property): the client resolves the host,
 * validates EVERY resolved IP, deterministically PINS one validated IP, and
 * hands that pinned IP to the transport. The transport connects to the pinned
 * IP (via a custom socket `lookup`) rather than re-resolving the hostname, so
 * the address that was validated is the address actually contacted. For HTTPS
 * the TLS SNI/servername and Host header remain the original hostname and
 * certificate verification stays enabled. Every redirect hop is re-resolved,
 * re-validated, and re-pinned. It fails closed on empty/blocked/ambiguous
 * resolution.
 */

export type ResolveHost = (hostname: string) => Promise<string[]>;

export interface TransportRequest {
  method: 'GET' | 'HEAD' | 'POST';
  url: string;
  hostname: string;
  /** The validated IP the connection must target. */
  pinnedIp: string;
  pinnedFamily: 4 | 6;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  locationHeader: string | null;
  bodyText: string;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface SafeHttpClientOptions {
  allowlist: string[];
  resolveHost?: ResolveHost;
  /** Pinned transport (injected in tests; defaults to the node pinned transport). */
  transport?: Transport;
  maxRedirects?: number;
  maxBytes?: number;
}

export interface SafeRequest {
  method: 'GET' | 'HEAD' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  correlationId: string;
}

export interface SafeResponse {
  status: number;
  bodyText: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
}

/**
 * Build a socket `lookup` that always returns the pinned IP, regardless of the
 * hostname passed. This forces the TCP connection to the validated address and
 * prevents any uncontrolled second DNS resolution.
 */
export function createPinnedLookup(ip: string, family: 4 | 6): LookupFunction {
  return ((_hostname: string, options: unknown, callback: unknown) => {
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { all?: boolean };
    const cb = (typeof options === 'function' ? options : callback) as (
      err: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    if (opts.all) {
      cb(null, [{ address: ip, family }]);
    } else {
      cb(null, ip, family);
    }
  }) as unknown as LookupFunction;
}

/**
 * Build outbound headers so the security boundary OWNS the Host header: the
 * intended hostname is applied last and cannot be overridden by caller/adapter
 * supplied headers.
 */
export function buildOutboundHeaders(
  headers: Record<string, string>,
  hostname: string,
): Record<string, string> {
  // Drop any caller-supplied host (case-insensitively), then set the intended one.
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'host') sanitized[key] = value;
  }
  sanitized.host = hostname;
  return sanitized;
}

/** Production transport: connects to the pinned IP with SNI/Host = hostname. */
const nodePinnedTransport: Transport = (req) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const url = new URL(req.url);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    const request = mod.request(
      {
        method: req.method,
        hostname: req.hostname, // Host header + TLS servername derive from this
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        // Security boundary owns the Host header (caller cannot override it).
        headers: buildOutboundHeaders(req.headers, req.hostname),
        lookup: createPinnedLookup(req.pinnedIp, req.pinnedFamily), // pin the socket
        servername: req.hostname, // preserve SNI (caller cannot override)
        rejectUnauthorized: true, // preserve certificate hostname verification
        signal: req.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxBytes) {
            request.destroy();
            reject(new IntegrationError('MALFORMED_RESPONSE', 'Response exceeded the maximum size.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const loc = res.headers.location;
          resolve({
            status: res.statusCode ?? 0,
            locationHeader: typeof loc === 'string' ? loc : null,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.on('error', () => {
      if (req.signal.aborted) {
        reject(new IntegrationError('TIMEOUT', 'Outbound request timed out.'));
      } else {
        // Never include the underlying error (could carry a URL/host).
        reject(new IntegrationError('NETWORK', 'Outbound request failed.'));
      }
    });

    if (req.body) request.write(req.body);
    request.end();
  });

export class SafeHttpClient {
  private readonly allowlist: string[];
  private readonly resolveHost: ResolveHost;
  private readonly transport: Transport;
  private readonly maxRedirects: number;
  private readonly maxBytes: number;

  constructor(options: SafeHttpClientOptions) {
    this.allowlist = options.allowlist;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    this.transport = options.transport ?? nodePinnedTransport;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Resolve, validate every IP, and deterministically select a pinned target. */
  private async pinDestination(url: URL): Promise<{ ip: string; family: 4 | 6 }> {
    let ips: string[];
    try {
      ips = await this.resolveHost(url.hostname);
    } catch {
      throw new IntegrationError('NETWORK', 'DNS resolution failed for destination.');
    }
    assertResolvedIpsAllowed(ips); // fail closed on empty / any blocked (ambiguous)
    const ip = ips[0]; // deterministic: first validated address
    return { ip, family: ip.includes(':') ? 6 : 4 };
  }

  async request(req: SafeRequest): Promise<SafeResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    let currentUrl = req.url;
    try {
      for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
        const url = assertAllowedOutboundUrl(currentUrl, this.allowlist); // scheme + host allow-list + blocked host
        const pinned = await this.pinDestination(url); // resolve + validate + pin (per hop)

        let res: TransportResponse;
        try {
          res = await this.transport({
            method: req.method,
            url: currentUrl,
            hostname: url.hostname,
            pinnedIp: pinned.ip,
            pinnedFamily: pinned.family,
            headers: { ...req.headers, 'x-correlation-id': req.correlationId },
            body: req.body,
            timeoutMs: req.timeoutMs,
            maxBytes: this.maxBytes,
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof IntegrationError) throw error;
          if (controller.signal.aborted) {
            throw new IntegrationError('TIMEOUT', 'Outbound request timed out.');
          }
          throw new IntegrationError('NETWORK', 'Outbound request failed.');
        }

        if (res.status >= 300 && res.status < 400) {
          if (!res.locationHeader) {
            throw new IntegrationError('NETWORK', 'Redirect response without a location.');
          }
          if (hop === this.maxRedirects) {
            throw new IntegrationError('NETWORK', 'Too many redirects.');
          }
          // Re-validate + re-resolve + re-pin the next hop on the next iteration.
          currentUrl = new URL(res.locationHeader, currentUrl).toString();
          continue;
        }

        if (Buffer.byteLength(res.bodyText, 'utf8') > this.maxBytes) {
          throw new IntegrationError('MALFORMED_RESPONSE', 'Response exceeded the maximum size.');
        }
        return { status: res.status, bodyText: res.bodyText };
      }
      throw new IntegrationError('NETWORK', 'Too many redirects.');
    } finally {
      clearTimeout(timer);
    }
  }
}
