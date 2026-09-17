import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token utilities.
 *
 * Session tokens are high-entropy random strings handed to the client in an
 * httpOnly cookie. Only the SHA-256 hash of a session token is ever persisted,
 * so a database read cannot reconstruct a usable session token.
 */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two same-purpose tokens (e.g. CSRF). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
