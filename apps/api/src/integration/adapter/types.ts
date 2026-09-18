import type { AdapterCapability, IntegrationEnvironment } from '@slc/shared';

/**
 * Resolved credentials injected into an adapter by the Integration Layer.
 * Values are held in memory only for the duration of a call and must never be
 * logged or returned to clients. Adapters never resolve secrets themselves.
 */
export interface ResolvedCredential {
  value: string;
  scopes: string[];
}
export type ResolvedCredentialMap = Record<string, ResolvedCredential>;

/** Per-call context handed to an adapter. */
export interface AdapterContext {
  correlationId: string;
  environment: IntegrationEnvironment;
  baseUrl: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
  credentials: ResolvedCredentialMap;
}

export interface ConnectionInfo {
  detail?: string;
}

export interface UserSummary {
  id: string;
  status?: string;
}

/**
 * Stable contract every application adapter implements. Only the capabilities
 * returned by `describeCapabilities()` may be invoked by the Integration Layer;
 * unsupported operations must not be called. Phase 4 ships only mock/noop
 * adapters — no adapter performs any external network call.
 */
export interface ApplicationAdapter {
  readonly type: string;
  describeCapabilities(): AdapterCapability[];
  validateConnection(ctx: AdapterContext): Promise<ConnectionInfo>;

  // Optional operations (present only when advertised as capabilities). Not
  // implemented by real adapters in Phase 4.
  getApplicationInfo?(ctx: AdapterContext): Promise<Record<string, unknown>>;
  getStatistics?(ctx: AdapterContext): Promise<Record<string, unknown>>;
  getUsers?(ctx: AdapterContext): Promise<UserSummary[]>;
  getUser?(ctx: AdapterContext, id: string): Promise<UserSummary>;
  disableUser?(ctx: AdapterContext, id: string): Promise<void>;
  enableUser?(ctx: AdapterContext, id: string): Promise<void>;
}
