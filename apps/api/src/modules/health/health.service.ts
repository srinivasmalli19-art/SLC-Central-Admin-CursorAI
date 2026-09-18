import type { DependencyStatus, HealthResponse, ServiceStatus } from '@slc/shared';
import { APP_NAME, API_VERSION } from '@slc/shared';

import { config } from '../../config/env.js';
import { pingDatabase } from '../../db/prisma.js';

/**
 * Health domain logic.
 *
 * Kept out of the route handler so it can be unit-tested and reused. Reports
 * overall status plus the connectivity state of downstream dependencies. When
 * no database is configured, connectivity is reported honestly rather than
 * faked.
 */
export async function getHealth(): Promise<HealthResponse> {
  let database: DependencyStatus = 'unknown';

  if (config.databaseUrl) {
    database = (await pingDatabase()) ? 'connected' : 'disconnected';
  } else {
    database = 'disconnected';
  }

  // Phase 1: a disconnected database degrades (rather than downs) the service,
  // because the foundation API is still fully operational without it.
  const status: ServiceStatus = database === 'connected' ? 'ok' : 'degraded';

  return {
    status,
    application: APP_NAME,
    version: API_VERSION,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: { database },
  };
}
