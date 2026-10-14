import type { CurrentUser } from '@slc/shared';

import { config } from '../../config/env.js';
import { requirePrisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../lib/password.js';
import { open, parseKey } from '../../lib/secretBox.js';
import { verifyTotp } from '../../lib/totp.js';
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
  otp?: string,
): Promise<LoginResult> {
  const prisma = requirePrisma();
  const email = normalizeEmail(emailInput);
  const breakGlass = config.breakGlass;
  // With SSO on, password sign-in is the break-glass path only.
  const isBreakGlass = Boolean(config.oidc);
  const notOnList = breakGlass.allowedEmails.length > 0 && !breakGlass.allowedEmails.includes(email);

  const admin = await prisma.adminUser.findUnique({ where: { email } });

  // Verify against a real hash when present; otherwise perform a dummy verify to
  // keep timing similar for unknown accounts.
  // SSO-only accounts have no local password and can never sign in here.
  const passwordOk = admin?.passwordHash
    ? await verifyPassword(admin.passwordHash, password)
    : await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zYWx0LXZhbHVl$3s8b2i3o8n1Zr8m8m9q0Xh0Zr8m8m9q0Xh0Zr8m8m9q',
        password,
      );

  if (!admin || admin.status === 'DISABLED' || !passwordOk || notOnList) {
    recordAuthEvent('ADMIN_LOGIN_FAILED', {
      email,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      adminUserId: admin?.id,
      metadata: {
        reason: !admin
          ? 'unknown_user'
          : admin.status === 'DISABLED'
            ? 'disabled'
            : !admin.passwordHash
              ? 'sso_only_account'
              : !passwordOk
                ? 'bad_password'
                : 'not_a_break_glass_account',
      },
    });
    throw INVALID_CREDENTIALS;
  }

  // --- Second factor (authenticator code) ----------------------------------
  const failMfa = (reason: string, error: AppError): never => {
    recordAuthEvent('ADMIN_LOGIN_FAILED', {
      email,
      adminUserId: admin.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason },
    });
    throw error;
  };
  let usedMfa = false;
  if (admin.mfaEnabled && admin.mfaSecret) {
    if (!otp) {
      failMfa('mfa_code_missing', new AppError(401, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app.'));
    }
    if (!breakGlass.mfaKey) {
      throw new AppError(500, 'MFA_NOT_CONFIGURED', 'Authenticator codes are not configured on this server.');
    }
    const secret = open(admin.mfaSecret, parseKey(breakGlass.mfaKey));
    const step = verifyTotp(secret, otp!, { notAfterStep: admin.mfaLastUsedStep });
    if (step === null) {
      failMfa('bad_mfa_code', new AppError(401, 'INVALID_CODE', 'That code is not valid. Wait for a new code and try again.'));
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { mfaLastUsedStep: step } });
    usedMfa = true;
  } else if (breakGlass.requireMfa) {
    failMfa(
      'mfa_not_set_up',
      new AppError(
        403,
        'MFA_SETUP_REQUIRED',
        'This account needs an authenticator app before it can sign in with a password. Ask whoever runs the server to enrol it.',
      ),
    );
  }

  const { token, expiresAt } = await createSession(admin.id, ctx, {}, isBreakGlass ? breakGlass.sessionHours : undefined);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const user = await getCurrentUser(admin.id);
  if (!user) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to load user after login.');
  }

  recordAuthEvent(isBreakGlass ? 'ADMIN_BREAK_GLASS_LOGIN' : 'ADMIN_LOGIN', {
    adminUserId: admin.id,
    email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { method: 'password', mfa: usedMfa },
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
    appRoles: admin.appRoles,
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

  if (!admin.passwordHash) {
    throw new AppError(
      409,
      'SSO_ACCOUNT',
      'This account signs in through central SSO. Change the password in the SLC account page.',
    );
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
