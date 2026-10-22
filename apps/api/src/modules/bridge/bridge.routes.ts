import cors from 'cors';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { sendSuccess } from '../../http/responses.js';
import { logger } from '../../lib/logger.js';
import { validate } from '../../middleware/validate.js';
import { exchangeForFirebaseToken, findBridgeApp, handleBridgeBackchannelLogout } from './firebaseBridge.service.js';

/**
 * Public endpoints called by SLC apps (cross-origin) and by Keycloak.
 * No Central Admin session is involved: each call carries a signed Keycloak
 * token that is verified for the specific app.
 */
export const bridgeRouter = Router();

const clientParams = z.object({ clientId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/) });
const tokenBody = z.object({ accessToken: z.string().min(20).max(20_000) });

/** CORS allow-list per bridged app (only that app's own origins). */
const perAppCors = cors((req, callback) => {
  const app = findBridgeApp(String((req as Request).params?.clientId ?? ''));
  const origin = req.headers.origin;
  callback(null, {
    origin: Boolean(app && origin && app.origins.includes(origin)),
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 600,
  });
});

bridgeRouter.options('/bridge/firebase/:clientId/token', perAppCors);
bridgeRouter.post(
  '/bridge/firebase/:clientId/token',
  perAppCors,
  validate({ params: clientParams, body: tokenBody }),
  (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    exchangeForFirebaseToken(req.params.clientId!, req.body.accessToken, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    })
      .then((result) => sendSuccess(res, result))
      .catch(next);
  },
);

bridgeRouter.post(
  '/bridge/firebase/:clientId/backchannel-logout',
  express.urlencoded({ extended: false, limit: '20kb' }),
  validate({ params: clientParams }),
  (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const token = (req.body as { logout_token?: unknown })?.logout_token;
    if (typeof token !== 'string') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    handleBridgeBackchannelLogout(req.params.clientId!, token)
      .then(() => res.status(200).end())
      .catch((error: unknown) => {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'bridge_backchannel_rejected');
        res.status(400).json({ error: 'invalid_request' });
      });
  },
);
