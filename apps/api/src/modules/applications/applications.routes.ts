import { Router } from 'express';
import { z } from 'zod';
import {
  APP_STATUSES,
  DEPLOYMENT_ENVIRONMENTS,
  INTEGRATION_STATUSES,
  INTEGRATION_TYPES,
  type AppStatus,
  type DeploymentEnvironment,
  type IntegrationStatus,
  type IntegrationType,
} from '@slc/shared';

import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  applicationStatsController,
  createApplicationController,
  getApplicationController,
  listApplicationsController,
  updateApplicationController,
} from './applications.controller.js';

export const applicationsRouter = Router();

const statusEnum = z.enum([...APP_STATUSES] as [AppStatus, ...AppStatus[]]);
const envEnum = z.enum([...DEPLOYMENT_ENVIRONMENTS] as [DeploymentEnvironment, ...DeploymentEnvironment[]]);
const integrationTypeEnum = z.enum([...INTEGRATION_TYPES] as [IntegrationType, ...IntegrationType[]]);
const integrationStatusEnum = z.enum([
  ...INTEGRATION_STATUSES,
] as [IntegrationStatus, ...IntegrationStatus[]]);

const nullableStr = (max = 500) => z.string().max(max).nullish();
const nullableUrl = z.string().url().max(2048).nullish();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  q: z.string().max(200).optional(),
  status: statusEnum.optional(),
  integrationType: integrationTypeEnum.optional(),
  integrationStatus: integrationStatusEnum.optional(),
  platform: z.string().max(100).optional(),
  sortBy: z.enum(['name', 'createdAt', 'status']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

const idParams = z.object({ id: z.string().uuid() });

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case.'),
  name: z.string().min(1).max(200),
  description: nullableStr(2000),
  platform: nullableStr(100),
  frontendTechnology: nullableStr(200),
  backendTechnology: nullableStr(200),
  databaseTechnology: nullableStr(200),
  authenticationTechnology: nullableStr(200),
  repositoryUrl: nullableUrl,
  productionUrl: nullableUrl,
  stagingUrl: nullableUrl,
  environment: envEnum.optional(),
  integrationType: integrationTypeEnum.optional(),
  adapterType: nullableStr(100),
  integrationStatus: integrationStatusEnum.optional(),
  status: statusEnum.optional(),
  version: nullableStr(50),
  healthCheckEnabled: z.boolean().optional(),
});

// Update: same shape without slug; every field optional.
const updateSchema = createSchema.partial().omit({ slug: true });

applicationsRouter.get(
  '/applications-stats',
  requireAuth,
  requirePermission('applications.view'),
  applicationStatsController,
);

applicationsRouter.get(
  '/applications',
  requireAuth,
  requirePermission('applications.view'),
  validate({ query: listQuerySchema }),
  listApplicationsController,
);

applicationsRouter.get(
  '/applications/:id',
  requireAuth,
  requirePermission('applications.view'),
  validate({ params: idParams }),
  getApplicationController,
);

applicationsRouter.post(
  '/applications',
  requireAuth,
  requirePermission('applications.manage'),
  validate({ body: createSchema }),
  createApplicationController,
);

applicationsRouter.patch(
  '/applications/:id',
  requireAuth,
  requirePermission('applications.manage'),
  validate({ params: idParams, body: updateSchema }),
  updateApplicationController,
);
