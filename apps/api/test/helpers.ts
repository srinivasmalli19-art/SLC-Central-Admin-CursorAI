import request from 'supertest';
import type { Express } from 'express';
import type { Permission, RoleKey } from '@slc/shared';

import { requirePrisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/lib/password.js';

const API = '/api/v1';

/** Remove all admin users/sessions and any custom test roles between suites. */
export async function resetDb(): Promise<void> {
  const prisma = requirePrisma();
  await prisma.adminUser.deleteMany({});
  const testRoles = await prisma.role.findMany({ where: { key: { startsWith: 'TEST_' } } });
  if (testRoles.length > 0) {
    const ids = testRoles.map((r) => r.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: ids } } });
    await prisma.role.deleteMany({ where: { id: { in: ids } } });
  }
}

export interface CreateAdminOptions {
  email: string;
  password: string;
  roleKeys?: RoleKey[];
  status?: 'ACTIVE' | 'DISABLED';
  name?: string;
}

export async function createAdmin(opts: CreateAdminOptions): Promise<string> {
  const prisma = requirePrisma();
  const passwordHash = await hashPassword(opts.password);
  const roles = opts.roleKeys?.length
    ? await prisma.role.findMany({ where: { key: { in: opts.roleKeys } } })
    : [];
  const user = await prisma.adminUser.create({
    data: {
      email: opts.email.toLowerCase(),
      passwordHash,
      name: opts.name ?? null,
      status: opts.status ?? 'ACTIVE',
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
  return user.id;
}

/** Create a minimal Application registry row and return its id. */
export async function createApplication(slug: string, name: string): Promise<string> {
  const prisma = requirePrisma();
  const row = await prisma.application.create({ data: { slug, name } });
  return row.id;
}

/** Create a custom role (key must start with TEST_) with explicit permissions. */
export async function createCustomRole(key: string, permissions: Permission[]): Promise<void> {
  const prisma = requirePrisma();
  const role = await prisma.role.create({ data: { key, name: key } });
  const perms = await prisma.permission.findMany({ where: { key: { in: permissions } } });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
}

export interface Authed {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  status: number;
  body: unknown;
}

/** Log in and return an agent whose cookies persist across requests. */
export async function loginAgent(app: Express, email: string, password: string): Promise<Authed> {
  const agent = request.agent(app);
  const res = await agent.post(`${API}/auth/login`).send({ email, password });
  const csrf =
    res.body?.data?.csrfToken && typeof res.body.data.csrfToken === 'string'
      ? res.body.data.csrfToken
      : '';
  return { agent, csrf, status: res.status, body: res.body };
}

export { API };
