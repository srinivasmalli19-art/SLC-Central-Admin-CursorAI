import type { CurrentUser } from '@slc/shared';

import { requirePrisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../lib/password.js';
import { recordAuthEvent } from './authEvents.js';
import { resolveAdmin } from './permissions.js';
import {
  createSession,
  revokeAllSessions,
  revokeSessionByToken,
  type SessionContext,
} from './session.service.js';

/** Generic, non-enumerating credential error. */
const INVALID_CREDENTIALS = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: CurrentUser;
}

/**
 * Authenticate an administrator by email + password and establish a session.
 *
 * Unknown user, wrong password, and disabled account all fail identically with
 * a generic error to avoid user enumeration.
 */
export async function login(
  emailInput: string,
  password: string,
  ctx: SessionContext = {},
): Promise<LoginResult> {
  const prisma = requirePrisma();
  const email = normalizeEmail(emailInput);

  const admin = await prisma.adminUser.findUnique({ where: { email } });

  // Verify against a real hash when present; otherwise perform a dummy verify to
  // keep timing similar for unknown accounts.
  const passwordOk = admin
    ? await verifyPassword(admin.passwordHash, password)
    : await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zYWx0LXZhbHVl$3s8b2i3o8n1Zr8m8m9q0Xh0Zr8m8m9q0Xh0Zr8m8m9q',
        password,
      );

  if (!admin || admin.status === 'DISABLED' || !passwordOk) {
    recordAuthEvent('ADMIN_LOGIN_FAILED', {
      email,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      adminUserId: admin?.id,
      metadata: { reason: !admin ? 'unknown_user' : admin.status === 'DISABLED' ? 'disabled' : 'bad_password' },
    });
    throw INVALID_CREDENTIALS;
  }

  // --- MFA extension point --------------------------------------------------
  // When `admin.mfaEnabled` is true, a future phase will issue an MFA challenge
  // here (e.g. TOTP) and defer session creation until the second factor is
  // verified. MFA is not implemented in Phase 2, so no account has it enabled.
  // --------------------------------------------------------------------------

  const { token, expiresAt } = await createSession(admin.id, ctx);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const user = await getCurrentUser(admin.id);
  if (!user) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load user after login.');
  }

  recordAuthEvent('ADMIN_LOGIN', {
    adminUserId: admin.id,
    email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { token, expiresAt, user };
}

/** Invalidate the current session. */
export async function logout(token: string, adminUserId?: string): Promise<void> {
  await revokeSessionByToken(token);
  recordAuthEvent('ADMIN_LOGOUT', { adminUserId });
}

/** Load the current authenticated administrator as a client-safe DTO. */
export async function getCurrentUser(adminUserId: string): Promise<CurrentUser | null> {
  const admin = await resolveAdmin(adminUserId);
  if (!admin) {
    return null;
  }
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    status: admin.status,
    mfaEnabled: admin.mfaEnabled,
    roles: admin.roles,
    permissions: admin.permissions,
  };
}

/** Self-service password change. Revokes all other sessions on success. */
export async function changePassword(
  adminUserId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const prisma = requirePrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) {
    throw new AppError(404, 'NOT_FOUND', 'Administrator not found.');
  }

  const ok = await verifyPassword(admin.passwordHash, currentPassword);
  if (!ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const problems = validatePasswordPolicy(newPassword, admin.email);
  if (problems.length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Password does not meet the policy.', {
      details: { issues: problems },
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash } });
  await revokeAllSessions(admin.id);

  recordAuthEvent('PASSWORD_CHANGED', { adminUserId: admin.id, email: admin.email });
}
