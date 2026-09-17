import { describe, expect, it } from 'vitest';

import { hashPassword, validatePasswordPolicy, verifyPassword } from './password.js';

describe('password hashing (argon2id)', () => {
  it('hashes and verifies a password, and rejects a wrong one', async () => {
    const hash = await hashPassword('Correct-Horse-Battery!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Correct-Horse-Battery!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('never returns the plaintext in the hash', async () => {
    const hash = await hashPassword('Correct-Horse-Battery!');
    expect(hash).not.toContain('Correct-Horse-Battery!');
  });
});

describe('password policy', () => {
  it('accepts a 12+ character password', () => {
    expect(validatePasswordPolicy('abcdefghijkl')).toHaveLength(0);
  });

  it('rejects passwords shorter than the minimum', () => {
    expect(validatePasswordPolicy('short').length).toBeGreaterThan(0);
  });

  it('rejects a password equal to the email', () => {
    const problems = validatePasswordPolicy('user@example.com', 'user@example.com');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('does not impose restrictive composition rules', () => {
    // A long lowercase-only passphrase is acceptable.
    expect(validatePasswordPolicy('correcthorsebatterystaple')).toHaveLength(0);
  });
});
