import { config } from '../../config/env.js';
import { requirePrisma } from '../../db/prisma.js';
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js';

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  /** Raw opaque token to place in the client cookie (never persisted). */
  token: string;
  expiresAt: Date;
}

/** Create a new server-side session and return the raw cookie token. */
export async function createSession(
  adminUserId: string,
  ctx: SessionContext = {},
): Promise<IssuedSession> {
  const prisma = requirePrisma();
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.cookie.ttlHours * 60 * 60 * 1000);

  await prisma.adminSession.create({
    data: {
      adminUserId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return { token, expiresAt };
}

export interface ActiveSession {
  id: string;
  adminUserId: string;
}

/**
 * Resolve a raw cookie token to an active (non-expired) session, sliding the
 * `lastUsedAt` timestamp. Expired sessions are deleted opportunistically.
 */
export async function resolveSession(token: string): Promise<ActiveSession | null> {
  const prisma = requirePrisma();
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  await prisma.adminSession
    .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { id: session.id, adminUserId: session.adminUserId };
}

/** Revoke a single session by its raw cookie token. */
export async function revokeSessionByToken(token: string): Promise<void> {
  const prisma = requirePrisma();
  await prisma.adminSession
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined);
}

/** Revoke every session for an admin (e.g. on disable or password change). */
export async function revokeAllSessions(adminUserId: string): Promise<number> {
  const prisma = requirePrisma();
  const result = await prisma.adminSession.deleteMany({ where: { adminUserId } });
  return result.count;
}
