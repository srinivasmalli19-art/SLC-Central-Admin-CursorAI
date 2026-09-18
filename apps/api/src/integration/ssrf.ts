import { IntegrationError } from './errors.js';

/**
 * SSRF / egress protection primitives.
 *
 * These are pure validators (no DNS, no network). The Integration Layer calls
 * `assertAllowedOutboundUrl` before any future adapter performs an HTTP request
 * so that outbound calls are restricted to explicitly allow-listed hosts and
 * never target private, loopback, link-local, or cloud-metadata ranges.
 */

/** Hostnames/CIDRs that must never be contacted from an adapter. */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, // loopback
  /^0\./,
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[0-1])\./, // RFC1918
  /^169\.254\./, // link-local (incl. 169.254.169.254 metadata)
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique-local
  /^fd[0-9a-f]{2}:/i,
];

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(host));
}

/**
 * Validate an outbound URL against an allow-list of hostnames. Throws an
 * SSRF_BLOCKED IntegrationError when the scheme is not https(/http), the host is
 * a private/loopback/link-local/metadata address, or the host is not allowed.
 */
export function assertAllowedOutboundUrl(rawUrl: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new IntegrationError('SSRF_BLOCKED', 'Invalid outbound URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new IntegrationError('SSRF_BLOCKED', 'Only http(s) outbound URLs are permitted.');
  }
  if (isBlockedHost(url.hostname)) {
    throw new IntegrationError('SSRF_BLOCKED', 'Outbound host is in a blocked range.');
  }
  const allowed = allowedHosts.map((h) => h.toLowerCase());
  if (!allowed.includes(url.hostname.toLowerCase())) {
    throw new IntegrationError('SSRF_BLOCKED', 'Outbound host is not allow-listed.');
  }
  return url;
}
