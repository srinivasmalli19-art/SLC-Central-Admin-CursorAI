import type { AdminUserStatus, RoleKey } from '@slc/shared';

import { requirePrisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';
import { hashPassword, validatePasswordPolicy } from '../../lib/password.js';
import { recordAuthEvent } from '../auth/authEvents.js';
import { normalizeEmail } from '../auth/auth.service.js';
import { hasPermission, type ResolvedAdmin } from '../auth/permissions.js';
import { revokeAllSessions } from '../auth/session.service.js';

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  status: AdminUserStatus;
  mfaEnabled: boolean;
  roles: RoleKey[];
  lastLoginAt: string | null;
  createdAt: string;
}

/** Count ACTIVE administrators holding SUPER_ADMIN, optionally excluding one. */
async function activeSuperAdminCount(excludeUserId?: string): Promise<number> {
  const prisma = requirePrisma();
  return prisma.adminUser.count({
    where: {
      status: 'ACTIVE',
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      roles: { some: { role: { key: 'SUPER_ADMIN' } } },
    },
  });
}

/**
 * Guard against removing the platform's last active SUPER_ADMIN. Throws when
 * the given target is an active SUPER_ADMIN and no other active SUPER_ADMIN
 * would remain after the operation.
 */
async function assertNotLastSuperAdmin(targetUserId: string): Promise<void> {
  const prisma = requirePrisma();
  const target = await prisma.adminUser.findUnique({
    where: { id: targetUserId },
    include: { roles: { include: { role: true } } },
  });
  const targetIsActiveSuper =
    target?.status === 'ACTIVE' && target.roles.some((r) => r.role.key === 'SUPER_ADMIN');
  if (!targetIsActiveSuper) {
    return;
  }
  const others = await activeSuperAdminCount(targetUserId);
  if (others < 1) {
    throw new AppError(
      409,
      'LAST_SUPER_ADMIN',
      'Cannot disable or remove the last active SUPER_ADMIN.',
    );
  }
}

/** Only actors with `system.manage` may grant the SUPER_ADMIN role. */
function assertMayAssignSuperAdmin(actor: ResolvedAdmin, roleKeys: RoleKey[]): void {
  if (roleKeys.includes('SUPER_ADMIN') && !hasPermission(actor, 'system.manage')) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only system administrators may assign the SUPER_ADMIN role.',
    );
  }
}

async function toSummary(userId: string): Promise<AdminUserSummary> {
  const prisma = requirePrisma();
  const user = await prisma.adminUser.findUniqueOrThrow({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    roles: user.roles.map((r) => r.role.key as RoleKey),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const prisma = requirePrisma();
  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
    include: { roles: { include: { role: true } } },
  });
  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
    roles: user.roles.map((r) => r.role.key as RoleKey),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }));
}

export interface CreateAdminUserInput {
  email: string;
  password: string;
  name?: string;
  roleKeys: RoleKey[];
}

export async function createAdminUser(
  input: CreateAdminUserInput,
  actor: ResolvedAdmin,
): Promise<AdminUserSummary> {
  const prisma = requirePrisma();
  const email = normalizeEmail(input.email);

  assertMayAssignSuperAdmin(actor, input.roleKeys);

  const problems = validatePasswordPolicy(input.password, email);
  if (problems.length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Password does not meet the policy.', {
      details: { issues: problems },
    });
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An administrator with this email already exists.');
  }

  const roles = await prisma.role.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'One or more roles do not exist.');
  }

  const passwordHash = await hashPassword(input.password);
  const created = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name: input.name,
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
  });

  recordAuthEvent('ROLE_CHANGED', {
    adminUserId: created.id,
    email,
    metadata: { action: 'created', roles: input.roleKeys, byAdminUserId: actor.id },
  });

  return toSummary(created.id);
}

export async function setAdminUserStatus(
  targetUserId: string,
  status: AdminUserStatus,
  actor: ResolvedAdmin,
): Promise<AdminUserSummary> {
  const prisma = requirePrisma();

  if (status === 'DISABLED') {
    await assertNotLastSuperAdmin(targetUserId);
  }

  const updated = await prisma.adminUser.update({
    where: { id: targetUserId },
    data: { status },
  });

  if (status === 'DISABLED') {
    await revokeAllSessions(targetUserId);
    recordAuthEvent('ADMIN_DISABLED', {
      adminUserId: targetUserId,
      email: updated.email,
      metadata: { byAdminUserId: actor.id },
    });
  }

  return toSummary(targetUserId);
}

export async function setAdminUserRoles(
  targetUserId: string,
  roleKeys: RoleKey[],
  actor: ResolvedAdmin,
): Promise<AdminUserSummary> {
  const prisma = requirePrisma();

  assertMayAssignSuperAdmin(actor, roleKeys);

  // If SUPER_ADMIN is being removed from the last active super admin, block it.
  if (!roleKeys.includes('SUPER_ADMIN')) {
    await assertNotLastSuperAdmin(targetUserId);
  }

  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
  if (roles.length !== roleKeys.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'One or more roles do not exist.');
  }

  await prisma.$transaction([
    prisma.adminUserRole.deleteMany({ where: { adminUserId: targetUserId } }),
    prisma.adminUserRole.createMany({
      data: roles.map((role) => ({ adminUserId: targetUserId, roleId: role.id })),
      skipDuplicates: true,
    }),
  ]);

  recordAuthEvent('ROLE_CHANGED', {
    adminUserId: targetUserId,
    metadata: { action: 'roles_set', roles: roleKeys, byAdminUserId: actor.id },
  });

  return toSummary(targetUserId);
}
