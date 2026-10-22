import { config, type KeycloakAdminConfig } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../lib/logger.js';

/**
 * Minimal Keycloak Admin REST API client (Keycloak 26).
 *
 * Authenticates as a dedicated service-account client (client-credentials
 * grant) that holds only the realm-management roles it needs (`view-users`,
 * `manage-users`, `query-groups`, `view-clients`). Tokens are cached in memory
 * until shortly before they expire. Nothing here is ever sent to the browser.
 */

export interface KcUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  createdTimestamp?: number;
  requiredActions?: string[];
  totp?: boolean;
}

export interface KcRole {
  id: string;
  name: string;
  description?: string;
  clientRole?: boolean;
  containerId?: string;
}

export interface KcClient {
  id: string;
  clientId: string;
  name?: string;
}

export interface KcGroup {
  id: string;
  name: string;
  path: string;
}

export interface KcCredential {
  id: string;
  type: string;
}

export class KeycloakAdminError extends AppError {
  constructor(
    readonly upstreamStatus: number,
    message: string,
  ) {
    super(
      upstreamStatus === 404 ? 404 : upstreamStatus === 409 ? 409 : 502,
      upstreamStatus === 404 ? 'NOT_FOUND' : upstreamStatus === 409 ? 'CONFLICT' : 'IDENTITY_PROVIDER_ERROR',
      message,
    );
  }
}


export function requireKeycloakAdminConfig(): KeycloakAdminConfig {
  if (!config.keycloakAdmin) {
    throw new AppError(
      503,
      'IDENTITY_NOT_CONFIGURED',
      'Central identity management is not configured (KEYCLOAK_ADMIN_CLIENT_ID / _SECRET).',
    );
  }
  return config.keycloakAdmin;
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let clientUuidCache = new Map<string, string>();

/** Test hook. */
export function resetKeycloakAdminCache(): void {
  cachedToken = null;
  clientUuidCache = new Map();
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  // Long enough for a provider that scales to zero to wake (IDP_TIMEOUT_SECONDS).
  const timeoutMs = (config.keycloakAdmin?.timeoutSeconds ?? 30) * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'keycloak_unreachable');
    throw new AppError(502, 'IDENTITY_PROVIDER_UNREACHABLE', 'The identity provider could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(cfg: KeycloakAdminConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 15_000) {
    return cachedToken.value;
  }
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/realms/${encodeURIComponent(cfg.realm)}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    },
  );
  if (!res.ok) {
    logger.error({ status: res.status }, 'keycloak_admin_token_failed');
    throw new KeycloakAdminError(res.status === 401 ? 502 : res.status, 'Central Admin could not authenticate to the identity provider.');
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

/** Call `<base>/admin/realms/<realm><path>`. Returns parsed JSON, or undefined for empty bodies. */
export async function kcRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ data: T; location: string | null }> {
  const cfg = requireKeycloakAdminConfig();
  const send = async (token: string) =>
    fetchWithTimeout(`${cfg.baseUrl}/admin/realms/${encodeURIComponent(cfg.realm)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send(await getAccessToken(cfg));
  if (res.status === 401) {
    // Token revoked or rotated: refresh once.
    cachedToken = null;
    res = await send(await getAccessToken(cfg));
  }

  if (!res.ok) {
    let detail = '';
    try {
      const err = (await res.json()) as { errorMessage?: string; error?: string };
      detail = err.errorMessage ?? err.error ?? '';
    } catch {
      // empty body
    }
    logger.warn({ status: res.status, method, path: path.replace(/[0-9a-f-]{36}/g, ':id'), detail }, 'keycloak_admin_request_failed');
    const message =
      res.status === 404
        ? 'Not found in the identity provider.'
        : res.status === 409
          ? detail || 'That account already exists in the identity provider.'
          : 'The identity provider rejected the request.';
    throw new KeycloakAdminError(res.status, message);
  }

  const text = await res.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, location: res.headers.get('location') };
}

/** Keycloak's internal UUID for a client id (cached). */
export async function getClientUuid(clientId: string): Promise<string> {
  const cached = clientUuidCache.get(clientId);
  if (cached) {
    return cached;
  }
  const { data } = await kcRequest<KcClient[]>('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
  const match = data.find((client) => client.clientId === clientId);
  if (!match) {
    throw new AppError(404, 'APP_NOT_FOUND', `App "${clientId}" is not registered in the identity provider.`);
  }
  clientUuidCache.set(clientId, match.id);
  return match.id;
}
