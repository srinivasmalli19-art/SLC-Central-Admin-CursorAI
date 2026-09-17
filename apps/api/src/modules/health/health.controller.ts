import type { NextFunction, Request, Response } from 'express';

import { sendSuccess } from '../../http/responses.js';
import { getHealth } from './health.service.js';

/** Thin controller: delegates to the service and formats the response. */
export async function healthController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const health = await getHealth();
    sendSuccess(res, health);
  } catch (error) {
    next(error);
  }
}
