import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../modules/auth/cookies.js';
import { safeEqual } from '../lib/tokens.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * Only enforced for state-changing methods on already-authenticated requests
 * (a session cookie is present). Unauthenticated flows such as login carry no
 * session cookie and are therefore exempt, while being protected by the
 * SameSite attribute on the session cookie. The client must echo the readable
 * `slc_csrf` cookie value in the `X-CSRF-Token` header.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const hasSession = Boolean(req.cookies?.[config.cookie.sessionName]);
  if (!hasSession) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
  const headerToken = req.get(CSRF_HEADER_NAME) ?? undefined;

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    next(new AppError(403, 'CSRF_FAILED', 'Invalid or missing CSRF token.'));
    return;
  }

  next();
}
