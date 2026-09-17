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
}

/**
 * Central navigation definition consumed by the web shell. Only the dashboard
 * placeholder exists in Phase 1; all other modules are explicitly marked as
 * not yet implemented.
 */
export const NAV_MODULES: readonly NavModule[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', implemented: true },
  { id: 'applications', label: 'Applications', path: '/applications', implemented: false },
  { id: 'users', label: 'Users', path: '/users', implemented: false },
  { id: 'content', label: 'Content', path: '/content', implemented: false },
  { id: 'notifications', label: 'Notifications', path: '/notifications', implemented: false },
  { id: 'reports', label: 'Reports', path: '/reports', implemented: false },
  { id: 'monitoring', label: 'Monitoring', path: '/monitoring', implemented: false },
  { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', implemented: false },
  { id: 'settings', label: 'Settings', path: '/settings', implemented: false },
] as const;
