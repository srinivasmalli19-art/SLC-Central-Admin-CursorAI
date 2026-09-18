import { Router } from 'express';
import { z } from 'zod';
import { ROLE_KEYS, type RoleKey } from '@slc/shared';

import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  createAdminUserController,
  listAdminUsersController,
  updateAdminUserRolesController,
  updateAdminUserStatusController,
} from './adminUsers.controller.js';

export const adminUsersRouter = Router();

const roleKeyEnum = z.enum([...ROLE_KEYS] as [RoleKey, ...RoleKey[]]);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  roleKeys: z.array(roleKeyEnum).nonempty(),
});

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

const rolesSchema = z.object({
  roleKeys: z.array(roleKeyEnum).nonempty(),
});

const idParams = z.object({ id: z.string().uuid() });

// All routes require authentication; authorization is permission-based and
// enforced here (authoritative), never in the frontend.
adminUsersRouter.get(
  '/admin-users',
  requireAuth,
  requirePermission('admin_users.view'),
  listAdminUsersController,
);

adminUsersRouter.post(
  '/admin-users',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ body: createSchema }),
  createAdminUserController,
);

adminUsersRouter.patch(
  '/admin-users/:id/status',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams, body: statusSchema }),
  updateAdminUserStatusController,
);

adminUsersRouter.put(
  '/admin-users/:id/roles',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams, body: rolesSchema }),
  updateAdminUserRolesController,
);
