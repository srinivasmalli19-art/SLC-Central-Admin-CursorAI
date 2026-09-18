import type { NextFunction, Request, Response } from 'express';
import type { ConfigureIntegrationInput, IntegrationEnvironment } from '@slc/shared';

import { sendSuccess } from '../../http/responses.js';
import { integrationService } from '../../integration/integration.service.js';

export async function listIntegrationsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const integrations = await integrationService.listIntegrations(req.params.id);
    sendSuccess(res, { integrations });
  } catch (error) {
    next(error);
  }
}

export async function getIntegrationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const integration = await integrationService.getIntegration(
      req.params.id,
      req.params.env as IntegrationEnvironment,
    );
    sendSuccess(res, { integration });
  } catch (error) {
    next(error);
  }
}

export async function configureIntegrationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const integration = await integrationService.configureIntegration(
      req.params.id,
      req.params.env as IntegrationEnvironment,
      req.body as ConfigureIntegrationInput,
    );
    sendSuccess(res, { integration });
  } catch (error) {
    next(error);
  }
}

export async function testIntegrationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await integrationService.testConnection(
      req.params.id,
      req.params.env as IntegrationEnvironment,
    );
    sendSuccess(res, { result });
  } catch (error) {
    next(error);
  }
}

export async function integrationCapabilitiesController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const integration = await integrationService.getIntegration(
      req.params.id,
      req.params.env as IntegrationEnvironment,
    );
    sendSuccess(res, { capabilities: integrationService.getCapabilities(integration.adapterType) });
  } catch (error) {
    next(error);
  }
}
