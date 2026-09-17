import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { config } from '../../config/env.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import {
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

authRouter.post('/auth/login', loginRateLimiter, validate({ body: loginSchema }), loginController);
authRouter.post('/auth/logout', requireAuth, logoutController);
authRouter.get('/auth/me', requireAuth, meController);
authRouter.post(
  '/auth/change-password',
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePasswordController,
);
