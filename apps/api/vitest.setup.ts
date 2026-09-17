// Hermetic test environment: run in `test` mode with no external database so
// health checks and configuration validation are deterministic regardless of
// the developer's shell or `.env`.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
