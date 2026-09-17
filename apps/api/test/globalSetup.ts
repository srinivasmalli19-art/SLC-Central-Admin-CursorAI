import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Vitest global setup.
 *
 * When TEST_DATABASE_URL is configured, prepares the integration test database
 * by applying migrations and seeding roles/permissions. When it is absent, does
 * nothing and the integration suites skip themselves.
 */
export async function setup(): Promise<void> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(dir, '../../..');
  loadDotenv({ path: path.resolve(repoRoot, '.env') });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      '[test] TEST_DATABASE_URL not set — auth/RBAC integration tests will be skipped.',
    );
    return;
  }

  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { cwd: repoRoot, env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { cwd: repoRoot, env, stdio: 'inherit' });
}
