import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { clearSessionCookie } from '../modules/auth/cookies.js';
import { recordAuthEvent } from '../modules/auth/authEvents.js';
import { resolveAdmin } from '../modules/auth/permissions.js';
import { resolveSession, revokeAllSessions } from '../modules/auth/session.service.js';

/**
 * Authentication middleware.
 *
 * Resolves the session cookie to an active session and an ACTIVE administrator,
 * attaching them to the request. Rejects (401) when unauthenticated, when the
 * session is missing/expired, or when the account has been disabled — a
 * disabled admin's existing sessions are revoked immediately.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.cookies?.[config.cookie.sessionName] as string | undefined;
    if (!token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const session = await resolveSession(token);
    if (!session) {
      clearSessionCookie(res);
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired.');
    }

    const admin = await resolveAdmin(session.adminUserId);
    if (!admin) {
      clearSessionCookie(res);
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is invalid or expired.');
    }

    if (admin.status === 'DISABLED') {
      await revokeAllSessions(admin.id);
      clearSessionCookie(res);
      recordAuthEvent('ADMIN_DISABLED', { adminUserId: admin.id, email: admin.email });
      throw new AppError(401, 'UNAUTHENTICATED', 'Account is disabled.');
    }

    req.admin = admin;
    req.sessionId = session.id;
    req.sessionToken = token;
    next();
  } catch (error) {
    next(error);
  }
}
