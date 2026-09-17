import type { ApiResponse, HealthResponse } from '@slc/shared';

/**
 * Minimal API client for the web shell.
 *
 * The browser only ever talks to its own origin; `/api` is proxied to the
 * Central Admin API in development (see vite.config.ts) and served behind the
 * same domain in production.
 */
const API_PREFIX = '/api/v1';

class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    throw new ApiClientError('Unable to reach the Central Admin API.');
  }

  let body: ApiResponse<T> | undefined;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    body = undefined;
  }

  if (!res.ok || !body || body.ok === false) {
    const message =
      body && body.ok === false ? body.error.message : `Request failed (${res.status}).`;
    throw new ApiClientError(message, res.status);
  }

  return body.data;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>('/health', signal);
}

export { ApiClientError };
