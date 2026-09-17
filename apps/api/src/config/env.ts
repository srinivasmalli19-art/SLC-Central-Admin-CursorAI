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
  };
}

/** Singleton config, validated once on first import. */
export const config: AppConfig = loadConfig();
