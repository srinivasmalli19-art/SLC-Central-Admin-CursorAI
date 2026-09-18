import { API_VERSION, APP_NAME } from '@slc/shared';

import { createApp } from './app.js';
import { config } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { logger } from './lib/logger.js';

/**
 * Bootstrap entrypoint.
 *
 * Configuration is validated on import (`config`). Here we build the app,
 * start listening, and wire up graceful shutdown.
 */
function main(): void {
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(
      { env: config.nodeEnv, port: config.port },
      `${APP_NAME} API listening on ${config.apiBaseUrl} (health: /api/${API_VERSION}/health)`,
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down API');
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
    // Force-exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
