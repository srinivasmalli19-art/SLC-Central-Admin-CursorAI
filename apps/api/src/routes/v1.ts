import { Router } from 'express';

import { healthRouter } from '../modules/health/health.routes.js';

/**
 * Versioned API router (`/api/v1`).
 *
 * New domain modules are mounted here as later phases add them
 * (auth, applications, users, audit-logs, ...). Phase 1 exposes health only.
 */
export const v1Router = Router();

v1Router.use('/', healthRouter);
