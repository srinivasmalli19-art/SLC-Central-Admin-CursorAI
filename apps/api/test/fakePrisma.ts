import { randomUUID } from 'node:crypto';

/**
 * Minimal in-memory stand-in for the Prisma client, covering only the calls the
 * auth + SSO code paths make. Lets the SSO flow test run end to end without a
 * PostgreSQL database. Not a general-purpose Prisma fake.
 */

interface AdminUserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  oidcSubject: string | null;
  name: string | null;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
interface RoleRow {
  id: string;
  key: string;
  name: string;
}
interface UserRoleRow {
  adminUserId: string;
  roleId: string;
}
interface SessionRow {
  id: string;
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  oidcSid: string | null;
  idTokenHint: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Where = Record<string, unknown>;

function matches(row: object, where: Where = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && 'in' in (value as object)) {
      return ((value as { in: unknown[] }).in ?? []).includes(actual);
    }
    return actual === value;
  });
}

export function createFakePrisma(roleKeys: readonly string[], rolePermissions: Record<string, readonly string[]>) {
  const users: AdminUserRow[] = [];
  const roles: RoleRow[] = roleKeys.map((key) => ({ id: randomUUID(), key, name: key }));
  const userRoles: UserRoleRow[] = [];
  const sessions: SessionRow[] = [];

  const withRoles = (user: AdminUserRow) => ({
    ...user,
    roles: userRoles
      .filter((ur) => ur.adminUserId === user.id)
      .map((ur) => {
        const role = roles.find((r) => r.id === ur.roleId)!;
        return {
          ...ur,
          role: {
            ...role,
            permissions: (rolePermissions[role.key] ?? []).map((key) => ({ permission: { key } })),
          },
        };
      }),
  });

  const prisma = {
    adminUser: {
      findUnique: async ({ where, include }: { where: Where; include?: unknown }) => {
        const user = users.find((u) => matches(u, where));
        if (!user) return null;
        return include ? withRoles(user) : { ...user };
      },
      create: async ({ data }: { data: Partial<AdminUserRow> }) => {
        if (users.some((u) => u.email === data.email)) throw new Error('unique email');
        const now = new Date();
        const row: AdminUserRow = {
          id: randomUUID(),
          email: data.email!,
          passwordHash: data.passwordHash ?? null,
          oidcSubject: data.oidcSubject ?? null,
          name: data.name ?? null,
          status: data.status ?? 'ACTIVE',
          mfaEnabled: false,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now,
        };
        users.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: Where; data: Partial<AdminUserRow> }) => {
        const user = users.find((u) => matches(u, where));
        if (!user) throw new Error('not found');
        Object.assign(user, data, { updatedAt: new Date() });
        return { ...user };
      },
    },
    role: {
      findMany: async ({ where }: { where: Where }) => roles.filter((r) => matches(r, where)),
    },
    adminUserRole: {
      findMany: async ({ where }: { where: Where }) =>
        userRoles
          .filter((ur) => matches(ur, where))
          .map((ur) => ({ ...ur, role: roles.find((r) => r.id === ur.roleId)! })),
      deleteMany: async ({ where }: { where: Where }) => {
        let count = 0;
        for (let i = userRoles.length - 1; i >= 0; i--) {
          if (matches(userRoles[i]!, where)) {
            userRoles.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
      createMany: async ({ data }: { data: UserRoleRow[] }) => {
        userRoles.push(...data);
        return { count: data.length };
      },
    },
    adminSession: {
      create: async ({ data }: { data: Partial<SessionRow> }) => {
        const row: SessionRow = {
          id: randomUUID(),
          adminUserId: data.adminUserId!,
          tokenHash: data.tokenHash!,
          expiresAt: data.expiresAt!,
          lastUsedAt: new Date(),
          oidcSid: data.oidcSid ?? null,
          idTokenHint: data.idTokenHint ?? null,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
        };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: { where: Where }) => {
        const row = sessions.find((s) => matches(s, where));
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: Where; data: Partial<SessionRow> }) => {
        const row = sessions.find((s) => matches(s, where));
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: { where: Where }) => {
        const index = sessions.findIndex((s) => matches(s, where));
        if (index < 0) throw new Error('not found');
        return sessions.splice(index, 1)[0];
      },
      deleteMany: async ({ where }: { where: Where }) => {
        let count = 0;
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (matches(sessions[i]!, where)) {
            sessions.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };

  return { prisma, state: { users, roles, userRoles, sessions } };
}
