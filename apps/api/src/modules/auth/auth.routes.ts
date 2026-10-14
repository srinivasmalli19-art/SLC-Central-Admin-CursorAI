import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import type { NextFunction, Request, Response } from 'express';

import { config } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import {
  oidcBackchannelLogoutController,
  oidcCallbackController,
  oidcLoginController,
} from './oidc/oidc.controller.js';
import {
  authOptionsController,
  changePasswordController,
  loginController,
  logoutController,
  meController,
} from './auth.controller.js';

export const authRouter = Router();

/**
 * Stricter rate limiter for authentication attempts, keyed by client IP + the
 * submitted email, to slow brute-force/credential-stuffing without harming
 * legitimate users.
 */
const loginRateLimiter = rateLimit({
  windowMs: config.login.rateLimitWindowMs,
  limit: config.login.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please try again later.' } },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/** Reject email + password sign-in when the deployment is SSO-only. */
function requirePasswordLogin(_req: Request, _res: Response, next: NextFunction): void {
  if (!config.passwordLoginEnabled) {
    next(new AppError(403, 'PASSWORD_LOGIN_DISABLED', 'Sign in with central SSO instead.'));
    return;
  }
  next();
}

/** SSO routes exist only when an identity provider is configured. */
function requireSso(_req: Request, _res: Response, next: NextFunction): void {
  if (!config.oidc) {
    next(new AppError(404, 'SSO_DISABLED', 'Central sign-in is not configured.'));
    return;
  }
  next();
}

/** Throttle SSO starts per IP (each one hits the IdP). */
const ssoRateLimiter = rateLimit({
  windowMs: config.login.rateLimitWindowMs,
  limit: config.login.rateLimitMax * 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

authRouter.get('/auth/config', authOptionsController);
authRouter.get('/auth/oidc/login', requireSso, ssoRateLimiter, oidcLoginController);
authRouter.get('/auth/oidc/callback', requireSso, ssoRateLimiter, oidcCallbackController);
authRouter.post('/auth/oidc/backchannel-logout', requireSso, oidcBackchannelLogoutController);

authRouter.post('/auth/login', requirePasswordLogin, loginRateLimiter, validate({ body: loginSchema }), loginController);
authRouter.post('/auth/logout', requireAuth, logoutController);
authRouter.get('/auth/me', requireAuth, meController);
authRouter.post(
  '/auth/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);
