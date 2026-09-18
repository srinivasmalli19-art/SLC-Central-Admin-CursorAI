import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';
import { sendError } from '../http/responses.js';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`);
}

/**
 * Centralized error handler.
 *
 * Operational `AppError`s are surfaced with their status/code. Any other error
 * is treated as unexpected: it is logged in full server-side but returned to
 * the client as a generic, sanitized 500 so internal details never leak.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express requires a 4-arg signature to treat this as an error handler.
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational AppError');
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  logger.error({ err }, 'Unhandled error');
  const message = config.isProduction
    ? 'An unexpected error occurred.'
    : err instanceof Error
      ? err.message
      : 'Unknown error';
  sendError(res, 500, 'INTERNAL_ERROR', message);
}
