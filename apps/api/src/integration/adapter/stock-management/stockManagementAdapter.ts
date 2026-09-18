import type { AdapterCapability } from '@slc/shared';

import { IntegrationError } from '../../errors.js';
import type { SafeHttpClient, SafeResponse } from '../../http/safeHttpClient.js';
import type { AdapterContext, ApplicationAdapter, ConnectionInfo, UserSummary } from '../types.js';
import {
  NoAuthProvider,
  PasswordLoginAuthProvider,
  StaticTokenAuthProvider,
  type StockAuthProvider,
} from './auth.js';
import {
  healthSchema,
  monitoringEnvelopeSchema,
  organisationsEnvelopeSchema,
  usersEnvelopeSchema,
} from './schemas.js';

export const STOCK_MANAGEMENT_ADAPTER_TYPE = 'stock-management-http';

/** Map an upstream HTTP status to a normalized IntegrationError (no bodies). */
function errorForStatus(status: number): IntegrationError {
  switch (status) {
    case 401:
      return new IntegrationError('UNAUTHORIZED', 'Upstream rejected credentials.', { retryable: false });
    case 403:
      return new IntegrationError('FORBIDDEN', 'Upstream denied access.', { retryable: false });
    case 404:
      return new IntegrationError('NOT_FOUND', 'Upstream resource not found.', { retryable: false });
    case 429:
      return new IntegrationError('RATE_LIMITED', 'Upstream rate limited.', { retryable: true });
    default:
      if (status >= 500) return new IntegrationError('UPSTREAM_5XX', 'Upstream server error.');
      return new IntegrationError('UPSTREAM_5XX', `Unexpected upstream status ${status}.`);
  }
}

function parseJson(res: SafeResponse): unknown {
  try {
    return JSON.parse(res.bodyText);
  } catch {
    throw new IntegrationError('MALFORMED_RESPONSE', 'Upstream returned invalid JSON.');
  }
}

/**
 * Read-only adapter foundation for Stock Management (FieldOps). All I/O goes
 * through the injected SafeHttpClient — this adapter never touches fetch/http/
 * https/axios/undici directly, and never performs a real request in tests.
 * Only source-confirmed READ endpoints are mapped; no write capabilities exist.
 */
export class StockManagementAdapter implements ApplicationAdapter {
  readonly type = STOCK_MANAGEMENT_ADAPTER_TYPE;

  constructor(private readonly http: SafeHttpClient) {}

  describeCapabilities(): AdapterCapability[] {
    // Read-only only. No users.disable / users.enable / writes.
    return ['connection.validate', 'application.statistics', 'users.list', 'application.info'];
  }

  private baseUrl(ctx: AdapterContext): string {
    if (!ctx.baseUrl) {
      throw new IntegrationError('CONFIG_INVALID', 'Stock Management base URL is not configured.');
    }
    return ctx.baseUrl.replace(/\/$/, '');
  }

  /** Choose an auth provider from injected credentials without persisting them. */
  private authProvider(ctx: AdapterContext): StockAuthProvider {
    const apiToken = ctx.credentials['api_token']?.value;
    if (apiToken) {
      return new StaticTokenAuthProvider(apiToken);
    }
    const email = ctx.credentials['email']?.value;
    const password = ctx.credentials['password']?.value;
    if (email && password) {
      return new PasswordLoginAuthProvider({
        http: this.http,
        baseUrl: this.baseUrl(ctx),
        credentials: { email, password },
      });
    }
    return new NoAuthProvider();
  }

  private async get(ctx: AdapterContext, path: string, auth: StockAuthProvider): Promise<SafeResponse> {
    // A single bounded re-auth on 401 (never unlimited retries).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await auth.getAccessToken(ctx.correlationId);
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;

      const res = await this.http.request({
        method: 'GET',
        url: `${this.baseUrl(ctx)}${path}`,
        headers,
        timeoutMs: ctx.timeoutMs,
        correlationId: ctx.correlationId,
      });

      if (res.status === 401 && attempt === 0 && token) {
        auth.onUnauthorized();
        continue; // one bounded re-auth
      }
      if (res.status >= 400) {
        throw errorForStatus(res.status);
      }
      return res;
    }
    throw errorForStatus(401);
  }

  async validateConnection(ctx: AdapterContext): Promise<ConnectionInfo> {
    // /health is public (no auth).
    const res = await this.http.request({
      method: 'GET',
      url: `${this.baseUrl(ctx)}/health`,
      headers: { accept: 'application/json' },
      timeoutMs: ctx.timeoutMs,
      correlationId: ctx.correlationId,
    });
    if (res.status >= 400) throw errorForStatus(res.status);
    const parsed = healthSchema.safeParse(parseJson(res));
    if (!parsed.success) {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Unexpected /health response shape.');
    }
    return { detail: `health:${parsed.data.status}` };
  }

  async getStatistics(ctx: AdapterContext): Promise<Record<string, unknown>> {
    const res = await this.get(ctx, '/api/monitoring', this.authProvider(ctx));
    const parsed = monitoringEnvelopeSchema.safeParse(parseJson(res));
    if (!parsed.success) {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Unexpected /api/monitoring response shape.');
    }
    return parsed.data.data;
  }

  async getUsers(ctx: AdapterContext): Promise<UserSummary[]> {
    const res = await this.get(ctx, '/api/users', this.authProvider(ctx));
    const parsed = usersEnvelopeSchema.safeParse(parseJson(res));
    if (!parsed.success) {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Unexpected /api/users response shape.');
    }
    // Preserve organisation identifiers; never merge across orgs.
    return parsed.data.data.map((u) => ({
      id: u.id,
      status: u.isActive ? 'active' : 'inactive',
      orgId: u.orgId,
    }));
  }

  async getApplicationInfo(ctx: AdapterContext): Promise<Record<string, unknown>> {
    const res = await this.get(ctx, '/api/organisations', this.authProvider(ctx));
    const parsed = organisationsEnvelopeSchema.safeParse(parseJson(res));
    if (!parsed.success) {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Unexpected /api/organisations response shape.');
    }
    return { organisations: parsed.data.data };
  }
}
