import type { CookieOptions, Response } from 'express';

import { config } from '../../config/env.js';
import { generateOpaqueToken } from '../../lib/tokens.js';

export const CSRF_COOKIE_NAME = 'slc_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

function baseCookieOptions(): CookieOptions {
  return {
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain: config.cookie.domain,
    path: '/',
  };
}

/** Set the httpOnly session cookie carrying the opaque token. */
export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(config.cookie.sessionName, token, {
    ...baseCookieOptions(),
    httpOnly: true,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.cookie.sessionName, { ...baseCookieOptions(), httpOnly: true });
}

/**
 * Issue a CSRF token via a readable (non-httpOnly) cookie for the double-submit
 * pattern. The SPA echoes this value in the `X-CSRF-Token` header on mutating
 * requests.
 */
export function issueCsrfCookie(res: Response): string {
  const token = generateOpaqueToken(24);
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    httpOnly: false,
    expires: new Date(Date.now() + config.cookie.ttlHours * 60 * 60 * 1000),
  });
  return token;
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, { ...baseCookieOptions(), httpOnly: false });
}
