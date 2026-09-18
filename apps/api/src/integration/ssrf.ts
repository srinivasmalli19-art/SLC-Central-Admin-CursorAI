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
 * Validate a resolved IP address (IPv4 or IPv6) against blocked ranges. This is
 * the DNS-rebinding defense: even an allow-listed hostname must not resolve to a
 * private/loopback/link-local/metadata/unique-local address.
 */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) — evaluate the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    return isBlockedIpv4(mapped[1]);
  }

  if (addr.includes(':')) {
    // IPv6
    if (addr === '::1' || addr === '::') return true; // loopback / unspecified
    if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
    return false;
  }

  return isBlockedIpv4(addr);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a parseable IPv4 — treat as blocked (fail closed).
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * Assert that every resolved IP for a destination is permitted. Fails closed
 * when the resolution set is empty or any address is in a blocked range.
 */
export function assertResolvedIpsAllowed(ips: string[]): void {
  if (!ips || ips.length === 0) {
    throw new IntegrationError('SSRF_BLOCKED', 'Destination did not resolve to any address.');
  }
  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      throw new IntegrationError('SSRF_BLOCKED', 'Destination resolves to a blocked address range.');
    }
  }
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
