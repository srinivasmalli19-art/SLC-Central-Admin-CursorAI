import { isIP } from 'node:net';

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
 *
 * Uses standards-correct parsing (Node `net.isIP` + a full IPv6 expander) so
 * that IPv4-mapped IPv6 addresses in ANY representation — dotted
 * (`::ffff:10.0.0.1`) or hexadecimal (`::ffff:a00:1`) — are normalized and their
 * embedded IPv4 is evaluated against the same blocked ranges. Anything that is
 * not a valid IP fails closed (blocked).
 */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const family = isIP(addr);

  if (family === 4) {
    return isBlockedIpv4(addr);
  }
  if (family === 6) {
    const hextets = expandIpv6(addr);
    if (!hextets) return true; // unparseable — fail closed
    return isBlockedIpv6(hextets);
  }
  return true; // not a valid IP address — fail closed
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

/** Evaluate the 8 hextets of a (valid) IPv6 address against blocked ranges. */
function isBlockedIpv6(h: number[]): boolean {
  const highZero = h.slice(0, 5).every((x) => x === 0);

  // IPv4-mapped ::ffff:0:0/96 — evaluate the embedded IPv4 in any representation.
  if (highZero && h[5] === 0xffff) {
    return isBlockedIpv4(embeddedIpv4(h[6], h[7]));
  }
  // IPv4-compatible ::a.b.c.d (deprecated) and ::/:: loopback/unspecified.
  if (h.slice(0, 6).every((x) => x === 0)) {
    const low = (h[6] << 16) | h[7];
    if (low === 0 || low === 1) return true; // :: (unspecified) / ::1 (loopback)
    return isBlockedIpv4(embeddedIpv4(h[6], h[7]));
  }
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false; // global unicast
}

function embeddedIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Expand a valid IPv6 string (already checked with `net.isIP`) into its 8
 * 16-bit hextets, handling `::` compression and an optional trailing
 * dotted-decimal IPv4 suffix. Returns null if it cannot be parsed.
 */
function expandIpv6(input: string): number[] | null {
  let s = input;

  // Convert a trailing dotted IPv4 (e.g. ...:1.2.3.4) into two hex groups.
  const dotted = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const b = dotted[2].split('.').map(Number);
    if (b.length !== 4 || b.some((n) => n < 0 || n > 255)) return null;
    s = `${dotted[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }

  const parseGroup = (g: string): number => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN);

  const doubleColon = s.split('::');
  let hextets: number[];
  if (doubleColon.length === 1) {
    const groups = s.split(':');
    if (groups.length !== 8) return null;
    hextets = groups.map(parseGroup);
  } else if (doubleColon.length === 2) {
    const head = doubleColon[0] ? doubleColon[0].split(':') : [];
    const tail = doubleColon[1] ? doubleColon[1].split(':') : [];
    const missing = 8 - (head.length + tail.length);
    if (missing < 1) return null;
    hextets = [...head, ...Array(missing).fill('0'), ...tail].map(parseGroup);
  } else {
    return null; // more than one '::'
  }

  if (hextets.length !== 8 || hextets.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) {
    return null;
  }
  return hextets;
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
