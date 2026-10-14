import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load environment from a local `.env` (if present) and then the shared
// repo-root `.env` used by Prisma. Existing values are never overridden, so
// real process environment (e.g. on Render) always takes precedence. Both the
// `src` and compiled `dist` layouts are four levels below the repo root.
// Tests run hermetically and must not read on-disk `.env` files.
if (process.env.NODE_ENV !== 'test') {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  loadDotenv();
  loadDotenv({ path: path.resolve(moduleDir, '../../../../.env') });
}

/**
 * Centralized environment configuration.
 *
 * All process configuration is validated here exactly once at startup. The
 * rest of the application imports the typed `config` object and never reads
 * `process.env` directly. Invalid configuration fails fast with a clear,
 * secret-free error message.
 */

/** Parse an explicit boolean env var ("true"/"false"/"1"/"0"). */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // ---- Session / cookie security (explicit, validated — not derived solely
  // from NODE_ENV) --------------------------------------------------------
  SESSION_COOKIE_NAME: z.string().min(1).default('slc_admin_session'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(720).default(12),
  /** Whether the session/CSRF cookies carry the `Secure` attribute. */
  COOKIE_SECURE: booleanFromString.optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /** Optional explicit cookie domain (e.g. admin.slcvet.com). */
  COOKIE_DOMAIN: z.string().min(1).optional(),

  // ---- Auth rate limiting ------------------------------------------------
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),

  // ---- Integration egress allow-list (Phase 5A) --------------------------
  // Comma-separated list of hostnames adapters may contact. Fail-closed: empty
  // by default so no outbound host is permitted until explicitly configured.
  INTEGRATION_EGRESS_ALLOWLIST: z.string().default(''),

  // ---- Central SSO (OIDC, e.g. Keycloak) ---------------------------------
  /** Issuer URL of the central identity provider, e.g. https://id.slcvet.com/realms/slc. */
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  /** Defaults to `${WEB_BASE_URL}/api/v1/auth/oidc/callback` (the web origin proxies /api). */
  OIDC_REDIRECT_URI: z.string().url().optional(),
  /** Where the IdP sends the browser after sign-out. Defaults to `${WEB_BASE_URL}/login`. */
  OIDC_POST_LOGOUT_REDIRECT_URI: z.string().url().optional(),
  /** Claim holding this app's role keys (dot path allowed, e.g. resource_access.central-admin.roles). */
  OIDC_ROLES_CLAIM: z.string().min(1).default('roles'),
  OIDC_SCOPES: z.string().min(1).default('openid email profile'),
  /** Label for the login button. */
  OIDC_PROVIDER_NAME: z.string().min(1).default('SLC Account'),
  /**
   * Whether the legacy email + password form stays available. Defaults to
   * true when SSO is not configured and false when it is.
   */
  PASSWORD_LOGIN_ENABLED: booleanFromString.optional(),

  // ---- Central identity management (Keycloak Admin API) -------------------
  /** Keycloak base URL, e.g. https://id.slcvet.com (defaults from OIDC_ISSUER_URL). */
  KEYCLOAK_BASE_URL: z.string().url().optional(),
  /** Realm holding SLC admins (defaults from OIDC_ISSUER_URL). */
  KEYCLOAK_REALM: z.string().min(1).optional(),
  /** Service-account client allowed to manage realm users. */
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).optional(),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Comma-separated `clientId=Display name` pairs for the apps whose admin
   * roles Central Admin manages.
   */
  KEYCLOAK_MANAGED_APPS: z
    .string()
    .default(
      'central-admin=SLC Central Admin,pasumithra-admin=Pasumithra,jeevamitra-admin=JeevaMitra,slcvet-admin=SLC Vet,stock-admin=Stock Management,nearsip-admin=NearSip,pasunestam-admin=Pasunestam',
    ),
  /** Whether to ask Keycloak to email new admins a set-password/MFA link. */
  KEYCLOAK_SEND_INVITE_EMAIL: booleanFromString.default('true'),

  // ---- Bootstrap (dev-only) super admin ----------------------------------
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface CookieConfig {
  sessionName: string;
  ttlHours: number;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  domain: string | undefined;
}

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  rolesClaim: string;
  scopes: string;
  providerName: string;
}

export interface KeycloakAdminConfig {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  managedApps: { clientId: string; name: string }[];
  sendInviteEmail: boolean;
}

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV'];
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  port: number;
  apiBaseUrl: string;
  webBaseUrl: string;
  databaseUrl: string | undefined;
  logLevel: RawEnv['LOG_LEVEL'];
  /** Origins permitted by CORS. */
  corsOrigins: string[];
  cookie: CookieConfig;
  login: { rateLimitMax: number; rateLimitWindowMs: number };
  bootstrap: { email: string | undefined; password: string | undefined };
  /** Central SSO settings; null when SSO is not configured. */
  oidc: OidcConfig | null;
  /** Keycloak Admin API settings; null when central identity management is off. */
  keycloakAdmin: KeycloakAdminConfig | null;
  /** Whether `POST /auth/login` (email + password) is accepted. */
  passwordLoginEnabled: boolean;
  integration: { egressAllowlist: string[] };
}

/**
 * Validate `process.env` and return a typed configuration object.
 * Throws a single, aggregated error when validation fails.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const isStaging = env.NODE_ENV === 'staging';
  const isDeployed = isProduction || isStaging;

  const errors: string[] = [];

  // A database connection string is mandatory in deployed environments.
  if (isDeployed && !env.DATABASE_URL) {
    errors.push('DATABASE_URL: required in production/staging');
  }

  // Cookie `Secure` is configured explicitly. Default to secure everywhere;
  // developers may opt out locally, but production/staging MUST be secure.
  const cookieSecure = env.COOKIE_SECURE ?? true;
  if (isDeployed && !cookieSecure) {
    errors.push('COOKIE_SECURE: must be true in production/staging');
  }
  // Browsers require Secure cookies when SameSite=None.
  if (env.COOKIE_SAMESITE === 'none' && !cookieSecure) {
    errors.push('COOKIE_SECURE: must be true when COOKIE_SAMESITE=none');
  }

  // Central SSO: all-or-nothing. Partial settings are a misconfiguration.
  const oidcValues = [env.OIDC_ISSUER_URL, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET];
  const oidcSetCount = oidcValues.filter(Boolean).length;
  if (oidcSetCount > 0 && oidcSetCount < oidcValues.length) {
    errors.push('OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be set together');
  }
  const oidcEnabled = oidcSetCount === oidcValues.length;
  if (isDeployed && oidcEnabled && env.OIDC_ISSUER_URL!.startsWith('http:')) {
    errors.push('OIDC_ISSUER_URL: must use https in production/staging');
  }
  const passwordLoginEnabled = env.PASSWORD_LOGIN_ENABLED ?? !oidcEnabled;
  if (!oidcEnabled && !passwordLoginEnabled) {
    errors.push('PASSWORD_LOGIN_ENABLED: cannot be false unless OIDC is configured (no way to sign in)');
  }

  // Central identity management needs a service account and a realm location.
  const kcIssuer = env.OIDC_ISSUER_URL?.match(/^(https?:\/\/.+?)\/realms\/([^/]+)\/?$/);
  const kcBaseUrl = env.KEYCLOAK_BASE_URL ?? kcIssuer?.[1];
  const kcRealm = env.KEYCLOAK_REALM ?? (kcIssuer ? decodeURIComponent(kcIssuer[2]!) : undefined);
  const kcCredsSet = [env.KEYCLOAK_ADMIN_CLIENT_ID, env.KEYCLOAK_ADMIN_CLIENT_SECRET].filter(Boolean).length;
  if (kcCredsSet === 1) {
    errors.push('KEYCLOAK_ADMIN_CLIENT_ID and KEYCLOAK_ADMIN_CLIENT_SECRET must be set together');
  }
  if (kcCredsSet === 2 && (!kcBaseUrl || !kcRealm)) {
    errors.push('KEYCLOAK_BASE_URL and KEYCLOAK_REALM are required (or an OIDC_ISSUER_URL ending in /realms/<realm>)');
  }
  if (isDeployed && kcCredsSet === 2 && kcBaseUrl?.startsWith('http:')) {
    errors.push('KEYCLOAK_BASE_URL: must use https in production/staging');
  }
  const managedApps = env.KEYCLOAK_MANAGED_APPS.split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [clientId, ...rest] = pair.split('=');
      return { clientId: clientId!.trim(), name: rest.join('=').trim() || clientId!.trim() };
    })
    .filter((app) => /^[A-Za-z0-9._-]{1,64}$/.test(app.clientId));

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    isStaging,
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    apiBaseUrl: env.API_BASE_URL,
    webBaseUrl: env.WEB_BASE_URL,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    corsOrigins: Array.from(new Set([env.WEB_BASE_URL])),
    cookie: {
      sessionName: env.SESSION_COOKIE_NAME,
      ttlHours: env.SESSION_TTL_HOURS,
      secure: cookieSecure,
      sameSite: env.COOKIE_SAMESITE,
      domain: env.COOKIE_DOMAIN,
    },
    login: {
      rateLimitMax: env.LOGIN_RATE_LIMIT_MAX,
      rateLimitWindowMs: env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    },
    bootstrap: {
      email: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD,
    },
    oidc: oidcEnabled
      ? {
          issuerUrl: env.OIDC_ISSUER_URL!,
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
          redirectUri:
            env.OIDC_REDIRECT_URI ?? `${env.WEB_BASE_URL.replace(/\/$/, '')}/api/v1/auth/oidc/callback`,
          postLogoutRedirectUri:
            env.OIDC_POST_LOGOUT_REDIRECT_URI ?? `${env.WEB_BASE_URL.replace(/\/$/, '')}/login`,
          rolesClaim: env.OIDC_ROLES_CLAIM,
          scopes: env.OIDC_SCOPES,
          providerName: env.OIDC_PROVIDER_NAME,
        }
      : null,
    keycloakAdmin:
      kcCredsSet === 2 && kcBaseUrl && kcRealm
        ? {
            baseUrl: kcBaseUrl.replace(/\/$/, ''),
            realm: kcRealm,
            clientId: env.KEYCLOAK_ADMIN_CLIENT_ID!,
            clientSecret: env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
            managedApps,
            sendInviteEmail: env.KEYCLOAK_SEND_INVITE_EMAIL,
          }
        : null,
    passwordLoginEnabled,
    integration: {
      egressAllowlist: env.INTEGRATION_EGRESS_ALLOWLIST.split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    },
  };
}

/** Singleton config, validated once on first import. */
export const config: AppConfig = loadConfig();
