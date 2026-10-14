import { describe, expect, it } from 'vitest';

import { displayNameFromClaims, extractRoleKeys, readClaimPath, sanitizeReturnTo } from './claims.js';

describe('SSO claim helpers', () => {
  it('reads top-level and nested (Keycloak resource_access) role claims', () => {
    const claims = {
      roles: ['SUPER_ADMIN'],
      resource_access: { 'central-admin': { roles: ['SUPPORT_ADMIN', 'REPORT_VIEWER'] } },
    };
    expect(extractRoleKeys(claims, 'roles')).toEqual(['SUPER_ADMIN']);
    expect(extractRoleKeys(claims, 'resource_access.central-admin.roles')).toEqual([
      'REPORT_VIEWER',
      'SUPPORT_ADMIN',
    ]);
  });

  it('ignores unknown roles, duplicates and malformed values (fail closed)', () => {
    expect(extractRoleKeys({ roles: ['admin', 'SUPER_ADMIN', 'SUPER_ADMIN', 42] }, 'roles')).toEqual([
      'SUPER_ADMIN',
    ]);
    expect(extractRoleKeys({ roles: 'APP_ADMIN' }, 'roles')).toEqual(['APP_ADMIN']);
    expect(extractRoleKeys({}, 'roles')).toEqual([]);
    expect(extractRoleKeys({ roles: { SUPER_ADMIN: true } }, 'roles')).toEqual([]);
    expect(readClaimPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('only allows same-origin relative return paths', () => {
    expect(sanitizeReturnTo('/applications?page=2')).toBe('/applications?page=2');
    expect(sanitizeReturnTo('https://evil.example')).toBe('/');
    expect(sanitizeReturnTo('//evil.example')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
    expect(sanitizeReturnTo('/api/v1/auth/logout')).toBe('/');
    expect(sanitizeReturnTo('/ok\r\nSet-Cookie: x')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });

  it('builds a display name from standard claims', () => {
    expect(displayNameFromClaims({ name: ' Ravi Kumar ' })).toBe('Ravi Kumar');
    expect(displayNameFromClaims({ given_name: 'Ravi', family_name: 'Kumar' })).toBe('Ravi Kumar');
    expect(displayNameFromClaims({})).toBeNull();
  });
});
