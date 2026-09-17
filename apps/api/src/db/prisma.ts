import { PrismaClient } from '@prisma/client';

import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Data-access layer entry point.
 *
 * A single PrismaClient instance is shared across the process. The client is
 * created lazily so the API can still boot (and report `database:
 * disconnected` via the health endpoint) when no database is configured — this
 * keeps local development and Phase 1 verification friction-free.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient | undefined {
  if (!config.databaseUrl) {
    return undefined;
  }
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: config.databaseUrl } },
      log: config.isDevelopment ? ['warn', 'error'] : ['error'],
    });
  }
  return client;
}

/**
 * Lightweight connectivity probe used by the health endpoint.
 * Returns true only when a trivial query succeeds.
 */
export async function pingDatabase(): Promise<boolean> {
  const prisma = getPrisma();
  if (!prisma) {
    return false;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Database connectivity check failed');
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
