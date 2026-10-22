import type { CurrentUser, RoleKey } from '@slc/shared';

import { requirePrisma } from '../../../db/prisma.js';
import { AppError } from '../../../errors/AppError.js';
import { normalizeEmail, getCurrentUser } from '../auth.service.js';
import { recordAuthEvent } from '../authEvents.js';
import {
  createSession,
  revokeAllSessions,
  revokeSessionsByOidcSid,
  type SessionContext,
} from '../session.service.js';
import { config } from '../../../config/env.js';
import { displayNameFromClaims, extractAppRoles, extractRoleKeys } from './claims.js';
import { requireOidcSettings } from './oidcClient.js';

/**
 * Central SSO sign-in: turns validated ID-token claims into a Central Admin
 * session.
 *
 * The identity provider (Keycloak) is the source of truth for WHO may sign in
 * and WHICH Central Admin roles they hold. On every SSO login the admin's local
 * role assignments are replaced by the roles in the token, so granting or
 * removing a role in Keycloak takes effect at the next sign-in. A local
 * DISABLED status is still honoured as an extra kill-switch.
 */

/** Error codes surfaced to the login page as `?error=<code>`. */
export type SsoErrorCode =
  | 'sso_failed'
  | 'sso_no_access'
  | 'sso_account_disabled'
  | 'sso_email_missing'
  | 'sso_email_unverified'
  | 'sso_email_conflict';

export class SsoLoginError extends AppError {
  constructor(
    readonly ssoCode: SsoErrorCode,
    message: string,
    status = 403,
  ) {
    super(status, 'SSO_LOGIN_REJECTED', message);
  }
}

export interface SsoLoginResult {
  token: string;
  expiresAt: Date;
  user: CurrentUser;
}

export async function completeSsoLogin(
  claims: Record<string, unknown> & { sub: string },
  idToken: string,
  ctx: SessionContext = {},
): Promise<SsoLoginResult> {
  const settings = requireOidcSettings();
  const prisma = requirePrisma();

  const subject = claims.sub;
  const rawEmail = typeof claims.email === 'string' ? claims.email : '';
  const email = rawEmail ? normalizeEmail(rawEmail) : '';
  const emailVerified = claims.email_verified === true;
  const roles = extractRoleKeys(claims, settings.rolesClaim);
  const name = displayNameFromClaims(claims);
  const sid = typeof claims.sid === 'string' ? claims.sid : undefined;
  const appRoles = extractAppRoles(claims, config.keycloakAdmin?.managedApps.map((app) => app.clientId));

  const fail = (code: SsoErrorCode, reason: string, adminUserId?: string): never => {
    recordAuthEvent('ADMIN_SSO_LOGIN_FAILED', {
      adminUserId,
      email: email || undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason, oidcSubject: subject },
    });
    throw new SsoLoginError(code, reason);
  };

  if (roles.length === 0) {
    fail('sso_no_access', 'no_central_admin_role');
  }
  if (!email) {
    fail('sso_email_missing', 'email_claim_missing');
  }

  // 1) Already linked by IdP subject.
  let admin = await prisma.adminUser.findUnique({ where: { oidcSubject: subject } });

  // 2) Existing local admin with the same (verified) email: link it once.
  if (!admin) {
    const byEmail = await prisma.adminUser.findUnique({ where: { email } });
    if (byEmail) {
      if (!emailVerified) {
        fail('sso_email_unverified', 'email_not_verified_for_linking', byEmail.id);
      }
      if (byEmail.oidcSubject && byEmail.oidcSubject !== subject) {
        fail('sso_email_conflict', 'email_linked_to_other_subject', byEmail.id);
      }
      admin = await prisma.adminUser.update({
        where: { id: byEmail.id },
        data: { oidcSubject: subject },
      });
      recordAuthEvent('ADMIN_SSO_LINKED', { adminUserId: admin.id, email, metadata: { oidcSubject: subject } });
    }
  }

  // 3) First sign-in: provision a local, SSO-only admin record.
  if (!admin) {
    admin = await prisma.adminUser.create({
      data: { email, name, oidcSubject: subject, passwordHash: null, status: 'ACTIVE' },
    });
    recordAuthEvent('ADMIN_SSO_PROVISIONED', {
      adminUserId: admin.id,
      email,
      metadata: { oidcSubject: subject, roles },
    });
  }

  if (admin.status === 'DISABLED') {
    fail('sso_account_disabled', 'disabled', admin.id);
  }

  await syncRoles(admin.id, roles);

  // Keep profile fields in step with the IdP (email only if it stays unique).
  const updates: { name?: string | null; email?: string; lastLoginAt: Date; appRoles: Record<string, string[]> } = {
    lastLoginAt: new Date(),
    appRoles,
  };
  if (name && name !== admin.name) {
    updates.name = name;
  }
  if (email !== admin.email) {
    const clash = await prisma.adminUser.findUnique({ where: { email } });
    if (!clash) {
      updates.email = email;
    }
  }
  await prisma.adminUser.update({ where: { id: admin.id }, data: updates });

  const { token, expiresAt } = await createSession(admin.id, ctx, { oidcSid: sid, idTokenHint: idToken });

  const user = await getCurrentUser(admin.id);
  if (!user) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load user after sign-in.');
  }

  recordAuthEvent('ADMIN_SSO_LOGIN', {
    adminUserId: admin.id,
    email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { oidcSubject: subject, roles, appRoles },
  });

  return { token, expiresAt, user };
}

/** Replace the admin's role assignments with exactly `roles` (IdP is authoritative). */
async function syncRoles(adminUserId: string, roles: RoleKey[]): Promise<void> {
  const prisma = requirePrisma();
  const current = await prisma.adminUserRole.findMany({
    where: { adminUserId },
    include: { role: true },
  });
  const currentKeys = current.map((r) => r.role.key).sort();
  if (currentKeys.join(',') === roles.join(',')) {
    return;
  }

  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  if (roleRows.length !== roles.length) {
    // Roles must be seeded (npm run db:seed) before SSO sign-in can map them.
    throw new AppError(500, 'ROLES_NOT_SEEDED', 'Central Admin roles are not seeded.');
  }

  await prisma.$transaction([
    prisma.adminUserRole.deleteMany({ where: { adminUserId } }),
    prisma.adminUserRole.createMany({
      data: roleRows.map((role) => ({ adminUserId, roleId: role.id })),
    }),
  ]);

  recordAuthEvent('ROLE_CHANGED', {
    adminUserId,
    metadata: { source: 'sso', from: currentKeys, to: roles },
  });
}

/**
 * Apply a verified back-channel logout from the IdP: end the matching IdP
 * session, or every session of that admin when only `sub` is given.
 */
export async function applyBackchannelLogout(claims: { sub?: string; sid?: string }): Promise<number> {
  const prisma = requirePrisma();
  let revoked = 0;
  let adminUserId: string | undefined;

  if (claims.sid) {
    revoked = await revokeSessionsByOidcSid(claims.sid);
  } else if (claims.sub) {
    const admin = await prisma.adminUser.findUnique({ where: { oidcSubject: claims.sub } });
    if (admin) {
      adminUserId = admin.id;
      revoked = await revokeAllSessions(admin.id);
    }
  }

  recordAuthEvent('ADMIN_SSO_BACKCHANNEL_LOGOUT', {
    adminUserId,
    metadata: { oidcSubject: claims.sub, oidcSid: claims.sid, revoked },
  });
  return revoked;
}
