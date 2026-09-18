import { lookup } from 'node:dns/promises';

import { IntegrationError } from '../errors.js';
import { assertAllowedOutboundUrl, assertResolvedIpsAllowed } from '../ssrf.js';

/**
 * The single guarded outbound HTTP client. Every external adapter MUST route
 * requests through this abstraction — adapters must not use `fetch`,
 * `http/https.request`, `axios`, or raw `undici` directly.
 *
 * The client owns: URL validation, DNS resolution + resolved-IP validation
 * (DNS-rebinding defense), a strict redirect policy (each hop re-validated),
 * timeouts, response-size limits, correlation-ID propagation, and safe error
 * normalization (never leaks bodies, headers, tokens, or cookies).
 *
 * No real network call occurs unless `fetchImpl`/`resolveHost` reach the network
 * — in tests these are injected fakes, so Phase 5A/5B make zero external calls.
 */

export type ResolveHost = (hostname: string) => Promise<string[]>;
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface SafeHttpClientOptions {
  allowlist: string[];
  resolveHost?: ResolveHost;
  fetchImpl?: FetchImpl;
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
  /** Raw response text, size-capped. Callers parse + schema-validate this. */
  bodyText: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

export class SafeHttpClient {
  private readonly allowlist: string[];
  private readonly resolveHost: ResolveHost;
  private readonly fetchImpl: FetchImpl;
  private readonly maxRedirects: number;
  private readonly maxBytes: number;

  constructor(options: SafeHttpClientOptions) {
    this.allowlist = options.allowlist;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    // Default to global fetch; only used for a real connection (never in tests).
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Validate scheme, host allow-list, blocked host, and resolved IPs. */
  private async validateDestination(rawUrl: string): Promise<URL> {
    const url = assertAllowedOutboundUrl(rawUrl, this.allowlist); // scheme + host allow-list + blocked-host
    let ips: string[];
    try {
      ips = await this.resolveHost(url.hostname);
    } catch {
      throw new IntegrationError('NETWORK', 'DNS resolution failed for destination.');
    }
    assertResolvedIpsAllowed(ips); // DNS-rebinding defense
    return url;
  }

  async request(req: SafeRequest): Promise<SafeResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    let currentUrl = req.url;
    try {
      for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
        await this.validateDestination(currentUrl);

        let res: Response;
        try {
          res = await this.fetchImpl(currentUrl, {
            method: req.method,
            headers: { ...req.headers, 'x-correlation-id': req.correlationId },
            body: req.body,
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) {
            throw new IntegrationError('TIMEOUT', 'Outbound request timed out.');
          }
          // Never include the underlying error message (could carry a URL/host).
          throw new IntegrationError('NETWORK', 'Outbound request failed.');
        }

        // Redirects: re-validate the next destination; fail closed on missing/invalid target.
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            throw new IntegrationError('NETWORK', 'Redirect response without a location.');
          }
          if (hop === this.maxRedirects) {
            throw new IntegrationError('NETWORK', 'Too many redirects.');
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        const bodyText = await res.text();
        if (Buffer.byteLength(bodyText, 'utf8') > this.maxBytes) {
          throw new IntegrationError('MALFORMED_RESPONSE', 'Response exceeded the maximum size.');
        }
        return { status: res.status, bodyText };
      }
      // Unreachable, but keep the type-checker satisfied and fail closed.
      throw new IntegrationError('NETWORK', 'Too many redirects.');
    } finally {
      clearTimeout(timer);
    }
  }
}
