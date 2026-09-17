import type { NextFunction, Request, Response } from 'express';

import { sendSuccess } from '../../http/responses.js';
import { clearCsrfCookie, clearSessionCookie, issueCsrfCookie, setSessionCookie } from './cookies.js';
import { changePassword, getCurrentUser, login, logout } from './auth.service.js';

function requestContext(req: Request): { ipAddress?: string; userAgent?: string } {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const result = await login(email, password, requestContext(req));

    setSessionCookie(res, result.token, result.expiresAt);
    const csrfToken = issueCsrfCookie(res);

    sendSuccess(res, { user: result.user, csrfToken });
  } catch (error) {
    next(error);
  }
}

export async function logoutController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.sessionToken) {
      await logout(req.sessionToken, req.admin?.id);
    }
    clearSessionCookie(res);
    clearCsrfCookie(res);
    sendSuccess(res, { loggedOut: true });
  } catch (error) {
    next(error);
  }
}

export async function meController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // `req.admin` is populated by requireAuth and already client-safe.
    const user = req.admin
      ? await getCurrentUser(req.admin.id)
      : null;
    if (!user) {
      clearSessionCookie(res);
      sendSuccess(res, { user: null });
      return;
    }
    sendSuccess(res, { user });
  } catch (error) {
    next(error);
  }
}

export async function changePasswordController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await changePassword(req.admin!.id, currentPassword, newPassword);
    // All sessions (including this one) were revoked; require re-login.
    clearSessionCookie(res);
    clearCsrfCookie(res);
    sendSuccess(res, { passwordChanged: true });
  } catch (error) {
    next(error);
  }
}
