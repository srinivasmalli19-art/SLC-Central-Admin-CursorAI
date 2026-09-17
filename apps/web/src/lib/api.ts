import type { CurrentUser, HealthResponse } from '@slc/shared';

/**
 * API client for the web shell.
 *
 * The browser only ever talks to its own origin; `/api` is proxied to the
 * Central Admin API in development and served behind the same domain in
 * production. Session state lives in an httpOnly cookie (never in JS-readable
 * storage). For mutating requests we echo the readable CSRF cookie in the
 * `X-CSRF-Token` header (double-submit pattern).
 */
const API_PREFIX = '/api/v1';
const CSRF_COOKIE = 'slc_csrf';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError('Unable to reach the Central Admin API.', 0, 'NETWORK_ERROR');
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  const envelope = payload as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
    | undefined;

  if (!res.ok || !envelope || envelope.ok === false) {
    const message =
      envelope && envelope.ok === false ? envelope.error.message : `Request failed (${res.status}).`;
    const code = envelope && envelope.ok === false ? envelope.error.code : 'HTTP_ERROR';
    throw new ApiClientError(message, res.status, code);
  }

  return envelope.data;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
};

export function fetchHealth(): Promise<HealthResponse> {
  return api.get<HealthResponse>('/health');
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: CurrentUser; csrfToken: string }>('/auth/login', { email, password }),
  logout: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
  me: () => api.get<{ user: CurrentUser | null }>('/auth/me'),
};
