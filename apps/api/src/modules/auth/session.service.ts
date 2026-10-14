import { config } from '../../config/env.js';
import { requirePrisma } from '../../db/prisma.js';
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js';

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

/** Extra data stored on sessions created through central SSO. */
export interface SsoSessionData {
  /** IdP session id (`sid` claim), used by back-channel logout. */
  oidcSid?: string;
  /** Raw ID token, kept only to send as `id_token_hint` at logout. */
  idTokenHint?: string;
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
  sso: SsoSessionData = {},
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
      oidcSid: sso.oidcSid,
      idTokenHint: sso.idTokenHint,
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

/** The ID token hint stored for an SSO session, if any (used at logout). */
export async function getIdTokenHint(token: string): Promise<string | null> {
  const prisma = requirePrisma();
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { idTokenHint: true },
  });
  return session?.idTokenHint ?? null;
}

/** Revoke every session tied to one IdP session (back-channel logout). */
export async function revokeSessionsByOidcSid(oidcSid: string): Promise<number> {
  const prisma = requirePrisma();
  const result = await prisma.adminSession.deleteMany({ where: { oidcSid } });
  return result.count;
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
