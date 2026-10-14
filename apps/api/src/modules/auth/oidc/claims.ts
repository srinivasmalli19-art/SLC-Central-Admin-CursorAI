import { ROLE_KEYS, type RoleKey } from '@slc/shared';

/**
 * Pure helpers for interpreting ID-token claims from the central identity
 * provider. Kept free of I/O so they are trivially unit-testable.
 */

/**
 * Read a claim by dot path, e.g. `roles` or `resource_access.central-admin.roles`.
 * Segment names may contain dashes; only `.` separates segments.
 */
export function readClaimPath(claims: Record<string, unknown>, path: string): unknown {
  let current: unknown = claims;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Extract the Central Admin role keys granted by the IdP. Unknown role names are
 * ignored (fail-closed), duplicates removed, and the result sorted so it can be
 * compared with the stored roles deterministically.
 */
export function extractRoleKeys(claims: Record<string, unknown>, path: string): RoleKey[] {
  const raw = readClaimPath(claims, path);
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const known = new Set<string>(ROLE_KEYS);
  const roles = new Set<RoleKey>();
  for (const value of values) {
    if (typeof value === 'string' && known.has(value)) {
      roles.add(value as RoleKey);
    }
  }
  return [...roles].sort();
}

/**
 * Accept only same-origin relative paths as a post-login destination, so the
 * login flow can never be abused as an open redirect.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return '/';
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  if (/[\r\n\t]/.test(value) || value.startsWith('/api/')) {
    return '/';
  }
  return value;
}

/** Display name from standard OIDC claims, or null. */
export function displayNameFromClaims(claims: Record<string, unknown>): string | null {
  const name = claims.name;
  if (typeof name === 'string' && name.trim()) {
    return name.trim().slice(0, 200);
  }
  const given = typeof claims.given_name === 'string' ? claims.given_name : '';
  const family = typeof claims.family_name === 'string' ? claims.family_name : '';
  const combined = `${given} ${family}`.trim();
  return combined ? combined.slice(0, 200) : null;
}
