import { describe, expect, it } from 'vitest';

import { assertAllowedOutboundUrl, isBlockedHost } from './ssrf.js';

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
