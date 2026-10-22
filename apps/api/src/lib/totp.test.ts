import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { open, seal } from './secretBox.js';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, timeStep, totpAt, verifyTotp } from './totp.js';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (8-digit values;
// the 6-digit code is the last six digits).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
];

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors', () => {
    for (const [seconds, eight] of RFC_VECTORS) {
      expect(totpAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(eight.slice(-6));
    }
  });

  it('round-trips base32 and makes 160-bit secrets', () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('accepts the current code and one step of drift, refuses replays and junk', () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 9, 14, 10, 0, 15);
    const step = timeStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), { nowMs: now, notAfterStep: step })).toBeNull();
    expect(verifyTotp(secret, '12345', { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
  });

  it('builds an otpauth URI authenticator apps accept', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'ops@slc.test'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('issuer')).toBe('SLC Central Admin');
  });
});

describe('secretBox (AES-256-GCM)', () => {
  it('round-trips and detects tampering or the wrong key', () => {
    const key = randomBytes(32);
    const sealed = seal('JBSWY3DPEHPK3PXP', key);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(sealed, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => open(sealed, randomBytes(32))).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(parts.join('.'), key)).toThrow();
  });
});
