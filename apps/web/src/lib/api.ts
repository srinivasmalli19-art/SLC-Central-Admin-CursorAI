import type {
  AppRoleMap,
  AuditLogEntry,
  AuditLogQuery,
  IdentityUser,
  InviteIdentityUserInput,
  InviteIdentityUserResult,
  ManagedApp,
  AuthOptions,
  LogoutResult,
  Application,
  ApplicationListQuery,
  ApplicationStats,
  CreateApplicationInput,
  CurrentUser,
  HealthResponse,
  PaginatedResult,
  UpdateApplicationInput,
} from '@slc/shared';

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
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function fetchHealth(): Promise<HealthResponse> {
  return api.get<HealthResponse>('/health');
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: CurrentUser; csrfToken: string }>('/auth/login', { email, password }),
  logout: () => api.post<LogoutResult>('/auth/logout'),
  me: () => api.get<{ user: CurrentUser | null }>('/auth/me'),
  options: () => api.get<AuthOptions>('/auth/config'),
  /** Full-page navigation target that starts central SSO sign-in. */
  ssoLoginUrl: (returnTo?: string) =>
    `${API_PREFIX}/auth/oidc/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
};

function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const applicationsApi = {
  list: (query: ApplicationListQuery = {}) =>
    api.get<PaginatedResult<Application>>(
      `/applications${toQueryString(query as Record<string, unknown>)}`,
    ),
  get: (id: string) => api.get<{ application: Application }>(`/applications/${id}`),
  create: (input: CreateApplicationInput) =>
    api.post<{ application: Application }>('/applications', input),
  update: (id: string, input: UpdateApplicationInput) =>
    api.patch<{ application: Application }>(`/applications/${id}`, input),
  stats: () => api.get<{ stats: ApplicationStats }>('/applications-stats'),
};

export const identityApi = {
  apps: () => api.get<{ apps: ManagedApp[] }>('/identity/apps'),
  users: (search?: string) =>
    api.get<{ users: IdentityUser[] }>(`/identity/users${toQueryString({ search, max: 100 })}`),
  invite: (input: InviteIdentityUserInput) => api.post<InviteIdentityUserResult>('/identity/users', input),
  setRoles: (id: string, appRoles: AppRoleMap) =>
    api.put<{ user: IdentityUser }>(`/identity/users/${encodeURIComponent(id)}/roles`, { appRoles }),
  setEnabled: (id: string, enabled: boolean) =>
    api.patch<{ user: IdentityUser }>(`/identity/users/${encodeURIComponent(id)}/status`, { enabled }),
  signOut: (id: string) => api.post<{ signedOut: boolean }>(`/identity/users/${encodeURIComponent(id)}/logout`),
  resendInvite: (id: string) => api.post<{ sent: boolean }>(`/identity/users/${encodeURIComponent(id)}/resend-invite`),
};

export const auditApi = {
  list: (query: AuditLogQuery = {}) =>
    api.get<PaginatedResult<AuditLogEntry>>(`/audit-logs${toQueryString({ ...query })}`),
  actions: () => api.get<{ actions: string[] }>('/audit-logs/actions'),
};

// ---- SLC apps managed from Central Admin ----------------------------------------
export interface JmUser {
  uid: string;
  name: string;
  phone: string;
  role: string;
  village: string | null;
  district: string | null;
  isVerified: boolean;
  isProfileComplete: boolean;
}
export interface JmAlert {
  id: string;
  title: string;
  disease: string;
  severity: string;
  district: string;
  village: string;
  isActive: boolean;
  issuedAt: string | null;
  reportedBy: string | null;
  sourceAuthority: string;
}
export interface JmSummary {
  users: number;
  farmers: number;
  shepherds: number;
  vets: number;
  vetsAwaitingVerification: number;
  farms: number;
  bookings: number;
  activeDiseaseAlerts: number;
}

export const jeevamitraApi = {
  summary: () => api.get<JmSummary>('/apps/jeevamitra/summary'),
  users: (q: { role?: string; verified?: boolean; after?: string } = {}) =>
    api.get<{ items: JmUser[]; nextCursor: string | null }>(
      `/apps/jeevamitra/users${toQueryString({ ...q, verified: q.verified === undefined ? undefined : String(q.verified), limit: 50 })}`,
    ),
  setVerified: (uid: string, verified: boolean) =>
    api.post<{ user: JmUser; vetProfilesUpdated: number }>(`/apps/jeevamitra/users/${encodeURIComponent(uid)}/verification`, { verified }),
  setDisabled: (uid: string, disabled: boolean) =>
    api.post<{ uid: string; disabled: boolean }>(`/apps/jeevamitra/users/${encodeURIComponent(uid)}/account`, { disabled }),
  alerts: (activeOnly = true) => api.get<{ alerts: JmAlert[] }>(`/apps/jeevamitra/alerts?activeOnly=${activeOnly}`),
  setAlertActive: (id: string, active: boolean) =>
    api.post<{ id: string; active: boolean }>(`/apps/jeevamitra/alerts/${encodeURIComponent(id)}/status`, { active }),
};

export type NsRow = Record<string, unknown> & { id: string };
export interface NsPlaceInput {
  name: string;
  type: 'drink' | 'food' | 'both' | 'hotspot';
  address: string | null;
  latitude: number;
  longitude: number;
  rating: number | null;
  is_hotspot: boolean;
  is_verified: boolean;
  is_popular: boolean;
}

export const nearsipApi = {
  summary: () => api.get<{ places: number; reviews: number; users: number }>('/apps/nearsip/summary'),
  places: (q: { search?: string; offset?: number } = {}) =>
    api.get<{ items: NsRow[]; total: number | null }>(`/apps/nearsip/places${toQueryString({ ...q, limit: 25 })}`),
  createPlace: (input: NsPlaceInput) => api.post<{ place: NsRow }>('/apps/nearsip/places', input),
  updatePlace: (id: string, input: Partial<NsPlaceInput>) =>
    api.patch<{ place: NsRow }>(`/apps/nearsip/places/${encodeURIComponent(id)}`, input),
  deletePlace: (id: string) => api.delete<{ deleted: boolean }>(`/apps/nearsip/places/${encodeURIComponent(id)}`),
  reviews: (offset = 0) => api.get<{ items: NsRow[]; total: number | null }>(`/apps/nearsip/reviews?limit=25&offset=${offset}`),
  deleteReview: (id: string) => api.delete<{ deleted: boolean }>(`/apps/nearsip/reviews/${encodeURIComponent(id)}`),
  users: (offset = 0) => api.get<{ items: NsRow[]; total: number | null }>(`/apps/nearsip/users?limit=25&offset=${offset}`),
  setUserDisabled: (id: string, disabled: boolean) =>
    api.post<{ id: string; disabled: boolean }>(`/apps/nearsip/users/${encodeURIComponent(id)}/account`, { disabled }),
};

// ---- Pasunestam ----------------------------------------------------------------
export interface PnSummary {
  vets: number;
  staff: number;
  certificatesIssued: number;
  certificatesCancelled: number;
  certificatesDraft: number;
  casesAwaitingReview: number;
  casesPublished: number;
  templates: number;
  templatesPublished: number;
  schemes: number;
  schemeApplications: number;
}
export type PnCaseStatus = 'submitted' | 'published' | 'rejected';
export interface PnCase {
  id: string;
  title: string;
  species: string;
  body: string;
  submitterName: string;
  submittedBy: string;
  status: PnCaseStatus;
  createdAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}
export interface PnCertificate {
  id: string;
  number: string | null;
  status: 'draft' | 'issued' | 'cancelled';
  templateId: string;
  vetName: string | null;
  vetInstitution: string | null;
  vetDistrict: string | null;
  issuedAt: string | null;
  createdAt: string | null;
  cancelledReason: string | null;
  cancelledAt: string | null;
}
export interface PnVet {
  uid: string;
  fullName: string | null;
  designation: string | null;
  registrationNo: string | null;
  institution: string | null;
  district: string | null;
  createdAt: string | null;
  email: string | null;
  disabled: boolean | null;
}
export interface PnTemplate {
  id: string;
  key: string;
  name: string;
  numberPrefix: string;
  published: boolean;
}
export interface PnScheme {
  id: string;
  name: string;
  tag: string;
  description: string;
  fileName: string | null;
  fileUrl: string | null;
  createdBy: string | null;
  createdAt: string | null;
}
export interface PnSchemeApplication {
  id: string;
  schemeId: string;
  applicantName: string;
  mobile: string;
  village: string;
  animalCount: string;
  createdBy: string | null;
  createdAt: string | null;
}

const PN = '/apps/pasunestam';
export const pasunestamApi = {
  summary: () => api.get<PnSummary>(`${PN}/summary`),
  cases: (status: PnCaseStatus = 'submitted') => api.get<{ cases: PnCase[] }>(`${PN}/cases?status=${status}`),
  reviewCase: (id: string, decision: 'published' | 'rejected') =>
    api.post<{ case: PnCase }>(`${PN}/cases/${encodeURIComponent(id)}/review`, { decision }),
  certificates: (q: { number?: string; status?: PnCertificate['status'] } = {}) =>
    api.get<{ certificates: PnCertificate[] }>(`${PN}/certificates${toQueryString(q)}`),
  cancelCertificate: (id: string, reason: string) =>
    api.post<{ certificate: PnCertificate }>(`${PN}/certificates/${encodeURIComponent(id)}/cancel`, { reason }),
  vets: (after?: string) => api.get<{ items: PnVet[]; nextCursor: string | null }>(`${PN}/vets${toQueryString({ after })}`),
  setVetDisabled: (uid: string, disabled: boolean) =>
    api.post<{ uid: string; disabled: boolean }>(`${PN}/vets/${encodeURIComponent(uid)}/account`, { disabled }),
  templates: () => api.get<{ templates: PnTemplate[] }>(`${PN}/templates`),
  setTemplatePublished: (id: string, published: boolean) =>
    api.post<{ template: PnTemplate }>(`${PN}/templates/${encodeURIComponent(id)}/published`, { published }),
  schemes: () => api.get<{ schemes: PnScheme[] }>(`${PN}/schemes`),
  deleteScheme: (id: string) => api.delete<{ deleted: boolean }>(`${PN}/schemes/${encodeURIComponent(id)}`),
  schemeApplications: () => api.get<{ applications: PnSchemeApplication[] }>(`${PN}/scheme-applications`),
};
