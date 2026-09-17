import type { Permission, RoleKey } from '@slc/shared';

import { requirePrisma } from '../../db/prisma.js';

export interface ResolvedAdmin {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  roles: RoleKey[];
  permissions: Permission[];
}

/**
 * Resolve an administrator's roles and effective (aggregated) permission set
 * from the database. This is the authoritative source for authorization
 * decisions on the backend.
 */
export async function resolveAdmin(adminUserId: string): Promise<ResolvedAdmin | null> {
  const prisma = requirePrisma();
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });

  if (!admin) {
    return null;
  }

  const roles = admin.roles.map((r) => r.role.key as RoleKey);
  const permissions = new Set<Permission>();
  for (const userRole of admin.roles) {
    for (const rp of userRole.role.permissions) {
      permissions.add(rp.permission.key as Permission);
    }
  }

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    status: admin.status,
    mfaEnabled: admin.mfaEnabled,
    roles,
    permissions: [...permissions],
  };
}

export function hasPermission(admin: Pick<ResolvedAdmin, 'permissions'>, permission: Permission): boolean {
  return admin.permissions.includes(permission);
}
