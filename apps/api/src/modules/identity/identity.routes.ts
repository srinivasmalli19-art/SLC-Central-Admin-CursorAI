import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { sendSuccess } from '../../http/responses.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import {
  getUser,
  inviteUser,
  listManagedApps,
  listUsers,
  resendInvite,
  setUserAppRoles,
  setUserEnabled,
  signOutUserEverywhere,
  type ActorContext,
} from './identity.service.js';

/**
 * Central identity management: SLC admin accounts and their per-app roles,
 * held in Keycloak. View requires `admin_users.view`; changes require
 * `admin_users.manage` (plus `system.manage` for anything touching a Super
 * Admin, enforced in the service).
 */
export const identityRouter = Router();

const appRoleMap = z.record(
  z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  z.array(z.string().min(1).max(100)).max(50),
);

const inviteSchema = z.object({
  email: z.string().email().max(254),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  appRoles: appRoleMap,
});

const rolesSchema = z.object({ appRoles: appRoleMap });
const statusSchema = z.object({ enabled: z.boolean() });
const idParams = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/) });
const listQuery = z.object({
  search: z.string().max(200).optional(),
  first: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(1).max(100).optional(),
});

function actor(req: Request): ActorContext {
  return { admin: req.admin!, ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res).catch(next);
};

identityRouter.get(
  '/identity/apps',
  requireAuth,
  requirePermission('admin_users.view'),
  wrap(async (_req, res) => sendSuccess(res, { apps: await listManagedApps() })),
);

identityRouter.get(
  '/identity/users',
  requireAuth,
  requirePermission('admin_users.view'),
  validate({ query: listQuery }),
  wrap(async (req, res) => sendSuccess(res, { users: await listUsers(listQuery.parse(req.query)) })),
);

identityRouter.get(
  '/identity/users/:id',
  requireAuth,
  requirePermission('admin_users.view'),
  validate({ params: idParams }),
  wrap(async (req, res) => sendSuccess(res, { user: await getUser(req.params.id!) })),
);

identityRouter.post(
  '/identity/users',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ body: inviteSchema }),
  wrap(async (req, res) => sendSuccess(res, await inviteUser(req.body, actor(req)), 201)),
);

identityRouter.put(
  '/identity/users/:id/roles',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams, body: rolesSchema }),
  wrap(async (req, res) =>
    sendSuccess(res, { user: await setUserAppRoles(req.params.id!, req.body.appRoles, actor(req)) }),
  ),
);

identityRouter.patch(
  '/identity/users/:id/status',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams, body: statusSchema }),
  wrap(async (req, res) =>
    sendSuccess(res, { user: await setUserEnabled(req.params.id!, req.body.enabled, actor(req)) }),
  ),
);

identityRouter.post(
  '/identity/users/:id/logout',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams }),
  wrap(async (req, res) => {
    await signOutUserEverywhere(req.params.id!, actor(req));
    sendSuccess(res, { signedOut: true });
  }),
);

identityRouter.post(
  '/identity/users/:id/resend-invite',
  requireAuth,
  requirePermission('admin_users.manage'),
  validate({ params: idParams }),
  wrap(async (req, res) => {
    await resendInvite(req.params.id!, actor(req));
    sendSuccess(res, { sent: true });
  }),
);
