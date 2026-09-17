import { Router } from 'express';

import { healthRouter } from '../modules/health/health.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { adminUsersRouter } from '../modules/admin-users/adminUsers.routes.js';

/**
 * Versioned API router (`/api/v1`).
 *
 * New domain modules are mounted here as later phases add them
 * (applications, audit-logs, ...). Phase 2 adds authentication and RBAC.
 */
export const v1Router = Router();

v1Router.use('/', healthRouter);
v1Router.use('/', authRouter);
v1Router.use('/', adminUsersRouter);
