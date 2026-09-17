import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Ensure config is validated in a deterministic test environment.
    env: {
      NODE_ENV: 'test',
    },
  },
});
