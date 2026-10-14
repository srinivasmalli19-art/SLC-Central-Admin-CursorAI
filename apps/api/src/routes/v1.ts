import { Router } from 'express';

import { healthRouter } from '../modules/health/health.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { adminUsersRouter } from '../modules/admin-users/adminUsers.routes.js';
import { applicationsRouter } from '../modules/applications/applications.routes.js';
import { integrationsRouter } from '../modules/integrations/integrations.routes.js';
import { identityRouter } from '../modules/identity/identity.routes.js';
import { auditRouter } from '../modules/audit/audit.routes.js';
import { bridgeRouter } from '../modules/bridge/bridge.routes.js';
import { jeevamitraRouter } from '../modules/apps/jeevamitra/jeevamitra.routes.js';
import { nearsipRouter } from '../modules/apps/nearsip/nearsip.routes.js';

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
v1Router.use('/', applicationsRouter);
v1Router.use('/', integrationsRouter);
v1Router.use('/', identityRouter);
v1Router.use('/', auditRouter);
v1Router.use('/', bridgeRouter);
v1Router.use('/', jeevamitraRouter);
v1Router.use('/', nearsipRouter);
