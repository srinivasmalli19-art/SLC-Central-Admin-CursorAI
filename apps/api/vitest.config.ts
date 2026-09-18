import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Load the repo-root .env (git-ignored) so a local TEST_DATABASE_URL can enable
// the integration suites without committing any credentials.
const dir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(dir, '../../.env') });
const testDbUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // Integration suites share one test database; run files serially.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Tests run over HTTP (no TLS); Secure cookies would not be resent.
      COOKIE_SECURE: 'false',
      ...(testDbUrl ? { DATABASE_URL: testDbUrl } : {}),
    },
  },
});
