import { IntegrationError } from '../../errors.js';
import type { SafeHttpClient } from '../../http/safeHttpClient.js';

/**
 * Authentication abstraction for the Stock Management adapter.
 *
 * The adapter depends only on this interface, so a future read-only service
 * token / API key can be introduced without redesigning the adapter. No real
 * credentials are created, stored, or logged here; credential material is
 * injected (already resolved) and kept in memory only.
 */
export interface StockAuthProvider {
  /** Return a bearer token to attach, or null for unauthenticated requests. */
  getAccessToken(correlationId: string): Promise<string | null>;
  /** Called on a 401 so the provider can invalidate any cached token. */
  onUnauthorized(): void;
}

/** No authentication (e.g. the public /health probe). */
export class NoAuthProvider implements StockAuthProvider {
  async getAccessToken(): Promise<string | null> {
    return null;
  }
  onUnauthorized(): void {
    /* nothing to invalidate */
  }
}

/**
 * Static bearer token (future read-only service token / API key). The token is
 * supplied already-resolved by the credential resolver and never logged.
 */
export class StaticTokenAuthProvider implements StockAuthProvider {
  constructor(private readonly token: string) {}
  async getAccessToken(): Promise<string | null> {
    return this.token;
  }
  onUnauthorized(): void {
    /* a static token cannot be refreshed */
  }
}

interface PasswordLoginDeps {
  http: SafeHttpClient;
  baseUrl: string;
  /** Resolved (in-memory) credentials — never persisted or logged. */
  credentials: { email: string; password: string };
  now?: () => number;
  /** Access-token cache lifetime; kept below the 15m server token TTL. */
  ttlMs?: number;
}

/**
 * Current source-confirmed mechanism: email/password login → JWT access token
 * (~15m) with a refresh cookie. Foundation only — this is exercised in tests
 * with a mocked SafeHttpClient and is NEVER pointed at a live host in 5A/5B.
 *
 * Token lifecycle: the access token is cached in memory (never persisted),
 * login is single-flight (no refresh storm), and authentication failures are
 * bounded (a single re-login on 401 is driven by the adapter).
 */
export class PasswordLoginAuthProvider implements StockAuthProvider {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: PasswordLoginDeps) {
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? 13 * 60 * 1000;
  }

  async getAccessToken(correlationId: string): Promise<string | null> {
    if (this.token && this.now() < this.expiresAt) {
      return this.token;
    }
    if (!this.inflight) {
      this.inflight = this.login(correlationId).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  onUnauthorized(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  private async login(correlationId: string): Promise<string> {
    const res = await this.deps.http.request({
      method: 'POST',
      url: `${this.deps.baseUrl}/api/auth/login`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: this.deps.credentials.email,
        password: this.deps.credentials.password,
      }),
      timeoutMs: 10_000,
      correlationId,
    });

    if (res.status === 401) {
      throw new IntegrationError('UNAUTHORIZED', 'Stock Management login failed.', { retryable: false });
    }
    if (res.status !== 200) {
      throw new IntegrationError('UPSTREAM_5XX', 'Stock Management login error.');
    }

    let token: unknown;
    try {
      token = (JSON.parse(res.bodyText) as { data?: { accessToken?: unknown } })?.data?.accessToken;
    } catch {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Invalid login response.');
    }
    if (typeof token !== 'string' || token.length === 0) {
      throw new IntegrationError('MALFORMED_RESPONSE', 'Login response missing access token.');
    }

    this.token = token;
    this.expiresAt = this.now() + this.ttlMs;
    return token;
  }
}
