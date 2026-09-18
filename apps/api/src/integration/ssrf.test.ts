import { describe, expect, it } from 'vitest';

import {
  assertAllowedOutboundUrl,
  assertResolvedIpsAllowed,
  isBlockedHost,
  isBlockedIp,
} from './ssrf.js';

describe('SSRF / egress validation', () => {
  it('flags private, loopback, link-local and metadata hosts', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('10.0.0.5')).toBe(true);
    expect(isBlockedHost('192.168.1.10')).toBe(true);
    expect(isBlockedHost('172.16.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('api.example.com')).toBe(false);
  });

  it('allows an allow-listed https host', () => {
    const url = assertAllowedOutboundUrl('https://api.example.com/v1', ['api.example.com']);
    expect(url.hostname).toBe('api.example.com');
  });

  function expectBlocked(fn: () => unknown) {
    try {
      fn();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('SSRF_BLOCKED');
      return;
    }
    throw new Error('expected an SSRF_BLOCKED error to be thrown');
  }

  it('blocks non-allow-listed hosts', () => {
    expectBlocked(() => assertAllowedOutboundUrl('https://evil.example.net', ['api.example.com']));
  });

  it('blocks private ranges even if somehow allow-listed', () => {
    expectBlocked(() =>
      assertAllowedOutboundUrl('http://169.254.169.254/latest/meta-data', ['169.254.169.254']),
    );
  });

  it('blocks non-http(s) schemes', () => {
    expectBlocked(() => assertAllowedOutboundUrl('file:///etc/passwd', ['whatever']));
    expectBlocked(() => assertAllowedOutboundUrl('gopher://x', ['x']));
  });
});

describe('resolved-IP validation (DNS-rebinding defense)', () => {
  it('blocks loopback, private, link-local, metadata and IPv6 local IPs', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('172.16.5.5')).toBe(true);
    expect(isBlockedIp('192.168.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedIp('100.100.0.1')).toBe(true); // CGNAT
    expect(isBlockedIp('0.0.0.0')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fd00::1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true); // mapped metadata
    // Public addresses are allowed.
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('fails closed on empty or blocked resolution sets', () => {
    expect(() => assertResolvedIpsAllowed([])).toThrowError();
    expect(() => assertResolvedIpsAllowed(['93.184.216.34', '10.0.0.1'])).toThrowError();
    expect(() => assertResolvedIpsAllowed(['93.184.216.34'])).not.toThrow();
  });
});
