import { Router } from 'express';
import { z } from 'zod';
import {
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_STATUSES,
  INTEGRATION_ENVIRONMENTS,
  type CredentialProvider,
  type CredentialStatus,
  type IntegrationEnvironment,
} from '@slc/shared';

import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  configureIntegrationController,
  getIntegrationController,
  integrationCapabilitiesController,
  listIntegrationsController,
  testIntegrationController,
} from './integrations.controller.js';

export const integrationsRouter = Router();

const envEnum = z.enum([...INTEGRATION_ENVIRONMENTS] as [IntegrationEnvironment, ...IntegrationEnvironment[]]);
const providerEnum = z.enum([...CREDENTIAL_PROVIDERS] as [CredentialProvider, ...CredentialProvider[]]);
const credStatusEnum = z.enum([...CREDENTIAL_STATUSES] as [CredentialStatus, ...CredentialStatus[]]);

const appParams = z.object({ id: z.string().uuid() });
const envParams = z.object({ id: z.string().uuid(), env: envEnum });

const credentialRefSchema = z.object({
  name: z.string().min(1).max(100),
  provider: providerEnum.optional(),
  // refKey is a NON-secret lookup key (e.g. an env var name), not a secret value.
  refKey: z.string().min(1).max(200),
  environment: envEnum,
  scopes: z.array(z.string().max(100)).max(50).optional(),
  status: credStatusEnum.optional(),
});

// NOTE: `connectionStatus` is intentionally NOT accepted here — it is
// system-authoritative and can never be set through this API. Unknown keys are
// stripped by zod, so any attempt to submit it is ignored.
const configureSchema = z.object({
  adapterType: z.string().min(1).max(100).nullish(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().max(2048).nullish(),
  timeoutMs: z.number().int().positive().max(120_000).nullish(),
  credentialReferences: z.array(credentialRefSchema).max(20).optional(),
});

integrationsRouter.get(
  '/applications/:id/integrations',
  requireAuth,
  requirePermission('integrations.view'),
  validate({ params: appParams }),
  listIntegrationsController,
);

integrationsRouter.get(
  '/applications/:id/integrations/:env',
  requireAuth,
  requirePermission('integrations.view'),
  validate({ params: envParams }),
  getIntegrationController,
);

integrationsRouter.get(
  '/applications/:id/integrations/:env/capabilities',
  requireAuth,
  requirePermission('integrations.view'),
  validate({ params: envParams }),
  integrationCapabilitiesController,
);

integrationsRouter.put(
  '/applications/:id/integrations/:env',
  requireAuth,
  requirePermission('integrations.manage'),
  validate({ params: envParams, body: configureSchema }),
  configureIntegrationController,
);

integrationsRouter.post(
  '/applications/:id/integrations/:env/test',
  requireAuth,
  requirePermission('integrations.test'),
  validate({ params: envParams }),
  testIntegrationController,
);
