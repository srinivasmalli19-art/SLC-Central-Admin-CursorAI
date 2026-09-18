import type { IntegrationErrorCode } from '@slc/shared';

/**
 * Normalized, adapter-agnostic integration error. Adapters and the Integration
 * Layer throw these so the core never sees raw external error shapes. Messages
 * must be safe (no secrets).
 */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly retryable: boolean;

  constructor(
    code: IntegrationErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE.has(code);
  }
}

/** Codes that are safe to retry by default (transient/idempotent failures). */
const DEFAULT_RETRYABLE = new Set<IntegrationErrorCode>([
  'TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_5XX',
  'NETWORK',
]);

/** Coerce any thrown value into a normalized IntegrationError. */
export function normalizeError(error: unknown): IntegrationError {
  if (error instanceof IntegrationError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new IntegrationError('TIMEOUT', 'Operation timed out.');
  }
  return new IntegrationError('NETWORK', 'Integration operation failed.');
}
