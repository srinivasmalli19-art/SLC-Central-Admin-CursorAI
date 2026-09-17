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

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV'];
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  port: number;
  apiBaseUrl: string;
  webBaseUrl: string;
  databaseUrl: string | undefined;
  logLevel: RawEnv['LOG_LEVEL'];
  /** Origins permitted by CORS. */
  corsOrigins: string[];
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

  // In production a database connection string is mandatory.
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
    throw new Error(
      'Invalid environment configuration:\n  - DATABASE_URL: required in production',
    );
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    apiBaseUrl: env.API_BASE_URL,
    webBaseUrl: env.WEB_BASE_URL,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    corsOrigins: Array.from(new Set([env.WEB_BASE_URL])),
  };
}

/** Singleton config, validated once on first import. */
export const config: AppConfig = loadConfig();
