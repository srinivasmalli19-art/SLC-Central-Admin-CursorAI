import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@slc/shared';

describe('role → permission mapping', () => {
  it('grants SUPER_ADMIN every permission', () => {
    expect([...ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('does not grant REPORT_VIEWER any administrative permissions', () => {
    const perms = ROLE_PERMISSIONS.REPORT_VIEWER;
    expect(perms).not.toContain('admin_users.view');
    expect(perms).not.toContain('admin_users.manage');
    expect(perms).not.toContain('system.manage');
    expect(perms).not.toContain('applications.manage');
  });

  it('restricts admin_users.manage and system.manage to SUPER_ADMIN only', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === 'SUPER_ADMIN') continue;
      expect(perms).not.toContain('admin_users.manage');
      expect(perms).not.toContain('system.manage');
    }
  });

  it('only references permissions that exist in the catalog', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(known.has(p)).toBe(true);
      }
    }
  });
});
