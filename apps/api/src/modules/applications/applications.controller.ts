import type { NextFunction, Request, Response } from 'express';
import type { ApplicationListQuery, CreateApplicationInput, UpdateApplicationInput } from '@slc/shared';

import { sendSuccess } from '../../http/responses.js';
import {
  createApplication,
  getApplication,
  getApplicationStats,
  listApplications,
  updateApplication,
} from './applications.service.js';

export async function listApplicationsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listApplications(req.query as ApplicationListQuery);
    sendSuccess(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getApplicationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const app = await getApplication(req.params.id);
    sendSuccess(res, { application: app });
  } catch (error) {
    next(error);
  }
}

export async function createApplicationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const app = await createApplication(req.body as CreateApplicationInput);
    sendSuccess(res, { application: app }, 201);
  } catch (error) {
    next(error);
  }
}

export async function updateApplicationController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const app = await updateApplication(req.params.id, req.body as UpdateApplicationInput);
    sendSuccess(res, { application: app });
  } catch (error) {
    next(error);
  }
}

export async function applicationStatsController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getApplicationStats();
    sendSuccess(res, { stats });
  } catch (error) {
    next(error);
  }
}
