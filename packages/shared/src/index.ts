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
  { id: 'applications', label: 'Applications', path: '/applications', implemented: false, permission: 'applications.view' },
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
  APP_ADMIN: ['applications.view', 'applications.manage', 'monitoring.view', 'reports.view'],
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
