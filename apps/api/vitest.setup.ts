// Run tests in `test` mode. Configuration is validated hermetically and does
// not read on-disk `.env` files (see src/config/env.ts). Integration suites
// receive DATABASE_URL via vitest `test.env` (from TEST_DATABASE_URL) and are
// skipped when it is absent.
process.env.NODE_ENV = 'test';
