import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@slc/shared';

/**
 * Password hashing using argon2id (OWASP-recommended for server-side auth).
 * Plaintext passwords are never stored or logged.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext);
}

export function verifyPassword(hashValue: string, plaintext: string): Promise<boolean> {
  return verify(hashValue, plaintext).catch(() => false);
}

/**
 * Practical, security-focused password policy: a 12-character minimum with a
 * sane maximum. Deliberately avoids restrictive composition rules that harm
 * usability. Returns an array of human-readable problems (empty = valid).
 */
export function validatePasswordPolicy(password: string, email?: string): string[] {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`);
  }
  if (password.trim().length === 0) {
    problems.push('Password must not be blank.');
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    problems.push('Password must not be the same as the email address.');
  }

  return problems;
}
