import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Small authenticated-encryption helper (AES-256-GCM) for secrets stored in the
 * database, such as a break-glass admin's authenticator secret. The key lives
 * only in the environment (`MFA_ENCRYPTION_KEY`, 32 bytes, base64), so a
 * database copy alone does not reveal the secrets.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64).');
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised sealed value.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
