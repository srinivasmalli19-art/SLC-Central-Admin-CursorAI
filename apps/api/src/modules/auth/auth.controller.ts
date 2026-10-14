import type { NextFunction, Request, Response } from 'express';

import type { AuthOptions, LogoutResult } from '@slc/shared';

import { config } from '../../config/env.js';
import { sendSuccess } from '../../http/responses.js';
import { logger } from '../../lib/logger.js';
import { buildLogoutUrl } from './oidc/oidcClient.js';
import { getIdTokenHint } from './session.service.js';
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
    const { email, password, otp } = req.body as { email: string; password: string; otp?: string };
    const result = await login(email, password, requestContext(req), otp);

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
    let ssoLogoutUrl: string | undefined;
    if (req.sessionToken) {
      // For SSO sessions, also end the central IdP session (single logout).
      const idTokenHint = config.oidc ? await getIdTokenHint(req.sessionToken) : null;
      if (idTokenHint) {
        ssoLogoutUrl = (await buildLogoutUrl(idTokenHint).catch((error: unknown) => {
          logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'oidc_logout_url_failed');
          return null;
        })) ?? undefined;
      }
      await logout(req.sessionToken, req.admin?.id);
    }
    clearSessionCookie(res);
    clearCsrfCookie(res);
    const result: LogoutResult = ssoLogoutUrl ? { loggedOut: true, ssoLogoutUrl } : { loggedOut: true };
    sendSuccess(res, result);
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

/** GET /auth/config — public: which sign-in methods the login page should offer. */
export function authOptionsController(_req: Request, res: Response): void {
  const options: AuthOptions = {
    passwordLoginEnabled: config.passwordLoginEnabled,
    ssoEnabled: Boolean(config.oidc),
    ssoProviderName: config.oidc?.providerName ?? null,
  };
  sendSuccess(res, options);
}
