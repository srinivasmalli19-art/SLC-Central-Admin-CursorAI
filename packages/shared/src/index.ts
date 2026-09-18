/**
 * @slc/shared
 *
 * Types and constants shared between the Central Admin API and web app.
 * Phase 1: foundation only — no business/domain models live here yet.
 */

/** Current API version segment used in all versioned routes (`/api/v1`). */
export const API_VERSION = 'v1' as const;

/** Human-readable application name, surfaced by the API and web shell. */
export const APP_NAME = 'SLC Central Admin' as const;

/** Supported runtime environments. */
export type AppEnvironment = 'development' | 'staging' | 'production' | 'test';

/** Overall service status values used across health reporting. */
export type ServiceStatus = 'ok' | 'degraded' | 'down';

/** Connectivity state for a downstream dependency (e.g. the database). */
export type DependencyStatus = 'connected' | 'disconnected' | 'unknown';

/** Payload returned by `GET /api/v1/health`. */
export interface HealthResponse {
  status: ServiceStatus;
  application: string;
  version: string;
  environment: AppEnvironment;
  timestamp: string;
  uptimeSeconds: number;
  dependencies: {
    database: DependencyStatus;
  };
}

/** Standard success envelope for API responses. */
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

/** Standard error envelope for API responses (never contains secrets). */
export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    /** Optional field-level validation details. */
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Navigation module identifiers for the web shell. */
export type NavModuleId =
  | 'dashboard'
  | 'applications'
  | 'users'
  | 'content'
  | 'notifications'
  | 'reports'
  | 'monitoring'
  | 'audit-logs'
  | 'settings';

export interface NavModule {
  id: NavModuleId;
  label: string;
  path: string;
  /** Whether the module has real functionality yet (false = "coming in a later phase"). */
  implemented: boolean;
  /**
   * Permission required to view this module. Used to guard routes and to gate
   * navigation affordances (UX only). The backend remains authoritative.
   * `undefined` means any authenticated admin may view it (e.g. the dashboard).
   */
  permission?: Permission;
}

/**
 * Central navigation definition consumed by the web shell. Only the dashboard
 * placeholder exists in Phase 1; all other modules are explicitly marked as
 * not yet implemented.
 */
export const NAV_MODULES: readonly NavModule[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', implemented: true },
  { id: 'applications', label: 'Applications', path: '/applications', implemented: true, permission: 'applications.view' },
  { id: 'users', label: 'Users', path: '/users', implemented: false, permission: 'users.view' },
  { id: 'content', label: 'Content', path: '/content', implemented: false, permission: 'content.view' },
  { id: 'notifications', label: 'Notifications', path: '/notifications', implemented: false, permission: 'notifications.view' },
  { id: 'reports', label: 'Reports', path: '/reports', implemented: false, permission: 'reports.view' },
  { id: 'monitoring', label: 'Monitoring', path: '/monitoring', implemented: false, permission: 'monitoring.view' },
  { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', implemented: false, permission: 'audit_logs.view' },
  { id: 'settings', label: 'Settings', path: '/settings', implemented: false, permission: 'system.manage' },
] as const;

// ============================================================================
// Authentication & RBAC (Phase 2)
// ----------------------------------------------------------------------------
// Central Admin has its OWN administrative identity system. These roles and
// permissions apply ONLY to the Central Admin platform and are never mixed with
// end-user identities from external SLC applications.
// ============================================================================

/** The complete permission catalog. Add new permissions here; the model is
 *  additive and requires no architectural changes. */
export const PERMISSIONS = [
  'applications.view',
  'applications.manage',
  'users.view',
  'users.manage',
  'content.view',
  'content.manage',
  'notifications.view',
  'notifications.send',
  'reports.view',
  'reports.export',
  'monitoring.view',
  'audit_logs.view',
  'admin_users.view',
  'admin_users.manage',
  'system.manage',
  'integrations.view',
  'integrations.manage',
  'integrations.test',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Central Admin role keys. */
export const ROLE_KEYS = [
  'SUPER_ADMIN',
  'APP_ADMIN',
  'CONTENT_ADMIN',
  'SUPPORT_ADMIN',
  'REPORT_VIEWER',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/** Human-readable role descriptions (used by the seed). */
export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: {
    name: 'Super Admin',
    description: 'Full control over the SLC Central Admin platform.',
  },
  APP_ADMIN: {
    name: 'Application Admin',
    description: 'Manages registered applications and their integrations.',
  },
  CONTENT_ADMIN: {
    name: 'Content Admin',
    description: 'Manages content and outbound notifications.',
  },
  SUPPORT_ADMIN: {
    name: 'Support Admin',
    description: 'Handles user support operations and monitoring.',
  },
  REPORT_VIEWER: {
    name: 'Report Viewer',
    description: 'Read-only access to reports.',
  },
};

/**
 * Authoritative role → permission mapping. This is the single source of truth
 * consumed by the database seed (backend enforcement) and by the frontend for
 * UX-only affordances. `SUPER_ADMIN` is granted every permission explicitly —
 * there is no hardcoded authorization bypass anywhere in the system.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  APP_ADMIN: [
    'applications.view',
    'applications.manage',
    'monitoring.view',
    'reports.view',
    'integrations.view',
    'integrations.manage',
    'integrations.test',
  ],
  CONTENT_ADMIN: ['content.view', 'content.manage', 'notifications.view', 'notifications.send'],
  SUPPORT_ADMIN: [
    'users.view',
    'users.manage',
    'applications.view',
    'monitoring.view',
    'notifications.view',
  ],
  REPORT_VIEWER: ['reports.view', 'reports.export'],
};

/** Admin account lifecycle state. */
export type AdminUserStatus = 'ACTIVE' | 'DISABLED';

/** Request body for `POST /api/v1/auth/login`. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** The authenticated administrator, as returned by `GET /api/v1/auth/me`. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  status: AdminUserStatus;
  mfaEnabled: boolean;
  roles: RoleKey[];
  permissions: Permission[];
}

/**
 * Authentication event names. Phase 2 emits these through a single choke point
 * (structured logs, secret-free); Phase 4 will persist them as audit logs
 * without changing the call sites.
 */
export type AuthEventType =
  | 'ADMIN_LOGIN'
  | 'ADMIN_LOGIN_FAILED'
  | 'ADMIN_LOGOUT'
  | 'ADMIN_DISABLED'
  | 'PASSWORD_CHANGED'
  | 'ROLE_CHANGED';

/** Minimum length for Central Admin passwords (practical, not restrictive). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// ============================================================================
// Application Registry (Phase 3)
// ----------------------------------------------------------------------------
// Central metadata about the applications in the SLC ecosystem. This is a
// registry only — it does NOT connect to, authenticate against, or call any
// external application backend. Unknown metadata is stored as NULL and rendered
// as `UNKNOWN` in the UI; it is never fabricated.
// ============================================================================

/** Label shown in the UI whenever a metadata field is null/unknown. */
export const UNKNOWN_LABEL = 'UNKNOWN' as const;

/** Application lifecycle status. Never inferred without evidence. */
export const APP_STATUSES = [
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION',
  'MAINTENANCE',
  'DEPRECATED',
  'UNKNOWN',
] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

/** Deployment environment descriptor. */
export const DEPLOYMENT_ENVIRONMENTS = ['DEVELOPMENT', 'STAGING', 'PRODUCTION', 'UNKNOWN'] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

/** How the central platform will (eventually) integrate with the application. */
export const INTEGRATION_TYPES = [
  'API',
  'FIREBASE_ADMIN',
  'SUPABASE',
  'REGISTRY_ONLY',
  'PENDING',
  'NONE',
] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

/**
 * Integration progress. `PLANNED` means a future intended integration only —
 * it must NEVER be treated as currently operational. `CONNECTED` is used only
 * once a real integration has actually been tested (not in Phase 3).
 */
export const INTEGRATION_STATUSES = [
  'NOT_STARTED',
  'PLANNED',
  'CONFIGURED',
  'TESTING',
  'CONNECTED',
  'DEGRADED',
  'DISCONNECTED',
  'NOT_APPLICABLE',
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** A registered application (client-safe DTO). Never contains secrets. */
export interface Application {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  platform: string | null;
  frontendTechnology: string | null;
  backendTechnology: string | null;
  databaseTechnology: string | null;
  authenticationTechnology: string | null;
  repositoryUrl: string | null;
  productionUrl: string | null;
  stagingUrl: string | null;
  environment: DeploymentEnvironment;
  integrationType: IntegrationType;
  adapterType: string | null;
  integrationStatus: IntegrationStatus;
  status: AppStatus;
  version: string | null;
  healthCheckEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a registry entry. */
export interface CreateApplicationInput {
  slug: string;
  name: string;
  description?: string | null;
  platform?: string | null;
  frontendTechnology?: string | null;
  backendTechnology?: string | null;
  databaseTechnology?: string | null;
  authenticationTechnology?: string | null;
  repositoryUrl?: string | null;
  productionUrl?: string | null;
  stagingUrl?: string | null;
  environment?: DeploymentEnvironment;
  integrationType?: IntegrationType;
  adapterType?: string | null;
  integrationStatus?: IntegrationStatus;
  status?: AppStatus;
  version?: string | null;
  healthCheckEnabled?: boolean;
}

export type UpdateApplicationInput = Partial<Omit<CreateApplicationInput, 'slug'>>;

export type ApplicationSortField = 'name' | 'createdAt' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface ApplicationListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: AppStatus;
  integrationType?: IntegrationType;
  integrationStatus?: IntegrationStatus;
  platform?: string;
  sortBy?: ApplicationSortField;
  sortDir?: SortDirection;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** DB-derived registry statistics for the dashboard. */
export interface ApplicationStats {
  total: number;
  production: number;
  development: number;
  registryOnly: number;
  pendingIntegrations: number;
}

// ============================================================================
// Integration Foundation (Phase 4)
// ----------------------------------------------------------------------------
// Foundation ONLY: per-environment integration configuration, credential
// REFERENCES (never secrets), adapter contract types, and the system-derived
// connection status. Phase 4 makes NO external calls and connects to NO real
// application. `Application.integrationStatus` (Phase 3) remains unchanged
// declared/registry metadata; `ApplicationIntegration.connectionStatus` (below)
// is the future system-authoritative live state.
// ============================================================================

/** Environments an integration can be configured for (excludes UNKNOWN). */
export const INTEGRATION_ENVIRONMENTS = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'] as const;
export type IntegrationEnvironment = (typeof INTEGRATION_ENVIRONMENTS)[number];

/**
 * System-authoritative connection status for an ApplicationIntegration.
 *
 * `NOT_CONFIGURED`, `CONFIGURED`, and `NOT_APPLICABLE` are derived from
 * configuration by the Integration Layer. `TESTING`, `CONNECTED`, `DEGRADED`,
 * and `DISCONNECTED` are produced ONLY by the Integration Layer after actual
 * adapter execution — they can never be asserted directly through an admin API.
 */
export const CONNECTION_STATUSES = [
  'NOT_CONFIGURED',
  'CONFIGURED',
  'TESTING',
  'CONNECTED',
  'DEGRADED',
  'DISCONNECTED',
  'NOT_APPLICABLE',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Connection statuses that only the system (Integration Layer) may set. */
export const SYSTEM_ONLY_CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  'TESTING',
  'CONNECTED',
  'DEGRADED',
  'DISCONNECTED',
];

/**
 * Where the secret material for a credential reference actually lives. Phase 4
 * only wires the `ENV` provider; the others are design placeholders and no
 * concrete production secrets manager is selected or implemented.
 */
export const CREDENTIAL_PROVIDERS = ['ENV', 'SECRET_STORE', 'SECRETS_MANAGER', 'ENCRYPTED_DB'] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

/** Lifecycle of a credential reference (supports rotation/revocation). */
export const CREDENTIAL_STATUSES = ['ACTIVE', 'ROTATING', 'REVOKED'] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/** Operations an adapter may advertise. Only advertised ones are ever invoked. */
export const ADAPTER_CAPABILITIES = [
  'connection.validate',
  'application.info',
  'application.statistics',
  'users.list',
  'users.get',
  'users.disable',
  'users.enable',
] as const;
export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];

/** Integration audit/observability event types (Phase 4 emits, no secrets). */
export const INTEGRATION_EVENT_TYPES = [
  'CONFIG_UPDATED',
  'INTEGRATION_ENABLED',
  'INTEGRATION_DISABLED',
  'CREDENTIAL_REFERENCE_UPDATED',
  'CREDENTIAL_ACCESSED',
  'CONNECTION_TEST_STARTED',
  'CONNECTION_TEST_SUCCEEDED',
  'CONNECTION_TEST_FAILED',
] as const;
export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

/** Normalized integration error codes (adapter-agnostic). */
export const INTEGRATION_ERROR_CODES = [
  'TIMEOUT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'UPSTREAM_5XX',
  'MALFORMED_RESPONSE',
  'NETWORK',
  'CIRCUIT_OPEN',
  'NOT_SUPPORTED',
  'ENVIRONMENT_MISMATCH',
  'CREDENTIAL_REVOKED',
  'SSRF_BLOCKED',
  'CONFIG_INVALID',
] as const;
export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

/** Client-safe credential reference DTO. NEVER contains secret material. */
export interface CredentialReferenceDto {
  id: string;
  name: string;
  provider: CredentialProvider;
  /** Non-secret lookup key/path in the backing store (not a secret value). */
  refKey: string;
  environment: IntegrationEnvironment;
  scopes: string[];
  version: number;
  status: CredentialStatus;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
}

/** Client-safe application-integration DTO. Contains no secrets. */
export interface ApplicationIntegrationDto {
  id: string;
  applicationId: string;
  environment: IntegrationEnvironment;
  adapterType: string | null;
  enabled: boolean;
  baseUrl: string | null;
  /** System-derived; never settable via admin APIs. */
  connectionStatus: ConnectionStatus;
  capabilities: AdapterCapability[];
  timeoutMs: number | null;
  lastTestedAt: string | null;
  lastError: string | null;
  credentialReferences: CredentialReferenceDto[];
  createdAt: string;
  updatedAt: string;
}

/** Input to configure an integration (no secret values, no connectionStatus). */
export interface CredentialReferenceInput {
  name: string;
  provider?: CredentialProvider;
  refKey: string;
  environment: IntegrationEnvironment;
  scopes?: string[];
  status?: CredentialStatus;
}

export interface ConfigureIntegrationInput {
  adapterType?: string | null;
  enabled?: boolean;
  baseUrl?: string | null;
  timeoutMs?: number | null;
  credentialReferences?: CredentialReferenceInput[];
}

/** Result of a connection test (no secrets). */
export interface ConnectionTestResult {
  connectionStatus: ConnectionStatus;
  ok: boolean;
  code: IntegrationErrorCode | null;
  message: string;
  capabilities: AdapterCapability[];
  correlationId: string;
}
