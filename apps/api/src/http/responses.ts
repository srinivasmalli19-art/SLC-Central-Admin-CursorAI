import type { Response } from 'express';
import type { ApiError, ApiSuccess } from '@slc/shared';

/** Send a standard success envelope. */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(statusCode).json(body);
}

/** Send a standard, secret-free error envelope. */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiError = { ok: false, error: { code, message, details } };
  res.status(statusCode).json(body);
}
