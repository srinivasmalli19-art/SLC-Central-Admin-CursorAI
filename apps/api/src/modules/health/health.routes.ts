import { Router } from 'express';

import { healthController } from './health.controller.js';

export const healthRouter = Router();

/**
 * GET /api/v1/health
 * Liveness/readiness probe reporting API status, environment, timestamp,
 * application name and database connectivity.
 */
healthRouter.get('/health', healthController);
