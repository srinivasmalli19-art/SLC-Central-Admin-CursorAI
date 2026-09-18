/**
 * Application error foundation.
 *
 * Route/service code throws typed `AppError`s; the centralized error handler
 * converts them into safe, consistent API error envelopes. This keeps business
 * logic out of Express handlers and prevents leaking internal details.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Whether this error is safe to surface to clients (operational). */
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; isOperational?: boolean } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(404, 'NOT_FOUND', message, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, { details });
  }
}
