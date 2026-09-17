/**
 * Seed the Central Admin roles and permissions from the shared catalog.
 *
 * This seeds CONFIG DATA ONLY (roles, permissions, and their mapping). It never
 * creates administrator accounts or passwords — the first SUPER_ADMIN is
 * created separately via the bootstrap script (see apps/api/scripts).
 *
 * Idempotent: safe to run repeatedly.
 */
import { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from '@slc/shared';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Permissions
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  // Roles + role→permission mapping
  for (const roleKey of ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[roleKey];
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: def.name, description: def.description },
      create: { key: roleKey, name: def.name, description: def.description },
    });

    const permissionKeys = ROLE_PERMISSIONS[roleKey as RoleKey];
    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...permissionKeys] } },
      select: { id: true },
    });

    // Reconcile the mapping to exactly match the shared source of truth.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  const [roleCount, permissionCount] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
  ]);
  console.log(`Seeded ${roleCount} roles and ${permissionCount} permissions.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
