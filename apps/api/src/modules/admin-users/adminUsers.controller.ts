import type { NextFunction, Request, Response } from 'express';
import type { AdminUserStatus, RoleKey } from '@slc/shared';

import { sendSuccess } from '../../http/responses.js';
import {
  createAdminUser,
  listAdminUsers,
  setAdminUserRoles,
  setAdminUserStatus,
} from './adminUsers.service.js';

export async function listAdminUsersController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, { adminUsers: await listAdminUsers() });
  } catch (error) {
    next(error);
  }
}

export async function createAdminUserController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as {
      email: string;
      password: string;
      name?: string;
      roleKeys: RoleKey[];
    };
    const created = await createAdminUser(body, req.admin!);
    sendSuccess(res, { adminUser: created }, 201);
  } catch (error) {
    next(error);
  }
}

export async function updateAdminUserStatusController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { status } = req.body as { status: AdminUserStatus };
    const updated = await setAdminUserStatus(req.params.id, status, req.admin!);
    sendSuccess(res, { adminUser: updated });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminUserRolesController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { roleKeys } = req.body as { roleKeys: RoleKey[] };
    const updated = await setAdminUserRoles(req.params.id, roleKeys, req.admin!);
    sendSuccess(res, { adminUser: updated });
  } catch (error) {
    next(error);
  }
}
