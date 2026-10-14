import type { NextFunction, Request, Response } from 'express';

import { config } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { issueCsrfCookie, setSessionCookie } from '../cookies.js';
import { sanitizeReturnTo } from './claims.js';
import { applyBackchannelLogout, completeSsoLogin, SsoLoginError, type SsoErrorCode } from './oidc.service.js';
import { buildAuthorizationRequest, exchangeCode, requireOidcSettings, verifyLogoutToken } from './oidcClient.js';

/**
 * Browser-facing SSO endpoints (backend-for-frontend pattern): the API performs
 * the whole OIDC exchange server-side, so no IdP token ever reaches browser
 * JavaScript. The browser only ends up with the same httpOnly session cookie +
 * CSRF cookie as a password login.
 */

/** Short-lived cookie carrying state/nonce/PKCE verifier between login and callback. */
export const OIDC_TXN_COOKIE = 'slc_oidc_txn';
const OIDC_TXN_PATH = '/api/v1/auth/oidc';
const OIDC_TXN_TTL_MS = 10 * 60 * 1000;

interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

function txnCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    // Must be Lax (not Strict): the callback is a top-level redirect FROM the IdP.
    sameSite: 'lax' as const,
    domain: config.cookie.domain,
    path: OIDC_TXN_PATH,
  };
}

function encodeTxn(txn: OidcTransaction): string {
  return Buffer.from(JSON.stringify(txn), 'utf8').toString('base64url');
}

function decodeTxn(raw: unknown): OidcTransaction | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<OidcTransaction>;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.codeVerifier === 'string'
    ) {
      return {
        state: parsed.state,
        nonce: parsed.nonce,
        codeVerifier: parsed.codeVerifier,
        returnTo: sanitizeReturnTo(parsed.returnTo),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

function loginPageUrl(error?: SsoErrorCode): string {
  const base = config.webBaseUrl.replace(/\/$/, '');
  return error ? `${base}/login?error=${encodeURIComponent(error)}` : `${base}/login`;
}

/** GET /auth/oidc/login — start sign-in by redirecting to the IdP. */
export async function oidcLoginController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requireOidcSettings();
    const request = await buildAuthorizationRequest();
    const txn: OidcTransaction = {
      state: request.state,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      returnTo: sanitizeReturnTo(req.query.returnTo),
    };
    res.cookie(OIDC_TXN_COOKIE, encodeTxn(txn), { ...txnCookieOptions(), maxAge: OIDC_TXN_TTL_MS });
    res.set('Cache-Control', 'no-store');
    res.redirect(302, request.url.href);
  } catch (error) {
    next(error);
  }
}

/** GET /auth/oidc/callback — finish sign-in and create the Central Admin session. */
export async function oidcCallbackController(req: Request, res: Response, next: NextFunction): Promise<void> {
  let settings;
  try {
    settings = requireOidcSettings();
  } catch (error) {
    next(error);
    return;
  }
  const txn = decodeTxn(req.cookies?.[OIDC_TXN_COOKIE]);
  res.clearCookie(OIDC_TXN_COOKIE, txnCookieOptions());
  res.set('Cache-Control', 'no-store');

  if (!txn) {
    logger.warn('oidc_callback_missing_transaction');
    res.redirect(302, loginPageUrl('sso_failed'));
    return;
  }

  // Rebuild the callback URL from the registered redirect URI (the request may
  // have arrived via the web dev proxy with a rewritten Host header).
  const callbackUrl = new URL(settings.redirectUri);
  const queryIndex = req.originalUrl.indexOf('?');
  callbackUrl.search = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';

  try {
    const { claims, idToken } = await exchangeCode(callbackUrl, txn);
    const result = await completeSsoLogin(claims, idToken, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    setSessionCookie(res, result.token, result.expiresAt);
    issueCsrfCookie(res);
    res.redirect(302, `${config.webBaseUrl.replace(/\/$/, '')}${txn.returnTo}`);
  } catch (error) {
    if (error instanceof SsoLoginError) {
      res.redirect(302, loginPageUrl(error.ssoCode));
      return;
    }
    // IdP errors (`?error=access_denied`), state/nonce/PKCE mismatches, bad
    // tokens: never leak details to the browser.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'oidc_callback_failed');
    res.redirect(302, loginPageUrl('sso_failed'));
  }
}

/** POST /auth/oidc/backchannel-logout — called server-to-server by the IdP. */
export async function oidcBackchannelLogoutController(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  const logoutToken = (req.body as { logout_token?: unknown } | undefined)?.logout_token;
  if (typeof logoutToken !== 'string' || logoutToken.length === 0) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  try {
    const claims = await verifyLogoutToken(logoutToken);
    await applyBackchannelLogout(claims);
    res.status(200).end();
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'oidc_backchannel_logout_rejected');
    res.status(400).json({ error: 'invalid_request' });
  }
}
