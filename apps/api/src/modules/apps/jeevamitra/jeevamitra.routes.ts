import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../../errors/AppError.js';
import { sendSuccess } from '../../../http/responses.js';
import { requireAuth } from '../../../middleware/requireAuth.js';
import { requireAppRole } from '../../../middleware/requirePermission.js';
import { validate } from '../../../middleware/validate.js';
import { writeAuditLog } from '../../audit/auditLog.service.js';
import { findBridgeApp } from '../../bridge/firebaseBridge.service.js';
import { FirestoreJeevaMitraStore, JEEVAMITRA_CLIENT_ID, type JeevaMitraStore } from './jeevamitra.store.js';

/**
 * JeevaMitra administration from Central Admin. Access comes from the admin's
 * SLC role for `jeevamitra-admin`: viewer = read, admin = verify vets and
 * moderate alerts, super_admin = also disable accounts.
 */
const READ = ['viewer', 'manager', 'super_admin'] as const;
const MANAGE = ['manager', 'super_admin'] as const;
const ACCOUNTS = ['super_admin'] as const;

let store: JeevaMitraStore = new FirestoreJeevaMitraStore();
/** Test hook. */
export function setJeevaMitraStore(next: JeevaMitraStore): void {
  store = next;
}

function requireConnected(_req: Request, _res: Response, next: NextFunction): void {
  if (!findBridgeApp(JEEVAMITRA_CLIENT_ID)) {
    next(new AppError(503, 'APP_NOT_CONNECTED', 'JeevaMitra is not connected (no service account configured).'));
    return;
  }
  next();
}

const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res).catch(next);
};

const uidParams = z.object({ uid: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/) });
const idParams = z.object({ id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) });
const usersQuery = z.object({
  role: z.enum(['farmer', 'shepherd', 'vet']).optional(),
  verified: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  after: z.string().max(128).optional(),
});
const alertsQuery = z.object({
  activeOnly: z.enum(['true', 'false']).default('true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function audit(req: Request, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  return writeAuditLog({
    action,
    actorId: req.admin!.id,
    actorEmail: req.admin!.email,
    targetType,
    targetId,
    metadata: { app: JEEVAMITRA_CLIENT_ID, ...metadata },
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  });
}

export const jeevamitraRouter = Router();
const base = '/apps/jeevamitra';
jeevamitraRouter.use(base, requireAuth, requireAppRole(JEEVAMITRA_CLIENT_ID, READ), requireConnected);

jeevamitraRouter.get(`${base}/summary`, wrap(async (_req, res) => sendSuccess(res, await store.summary())));

jeevamitraRouter.get(
  `${base}/users`,
  validate({ query: usersQuery }),
  wrap(async (req, res) => {
    const q = usersQuery.parse(req.query);
    sendSuccess(
      res,
      await store.listUsers({ role: q.role, verified: q.verified === undefined ? undefined : q.verified === 'true', limit: q.limit, after: q.after }),
    );
  }),
);

jeevamitraRouter.post(
  `${base}/users/:uid/verification`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: uidParams, body: z.object({ verified: z.boolean() }) }),
  wrap(async (req, res) => {
    const user = await store.getUser(req.params.uid!);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'JeevaMitra user not found.');
    if (user.role !== 'vet') throw new AppError(422, 'NOT_A_VET', 'Only vet accounts can be verified.');
    const result = await store.setVetVerified(user.uid, req.body.verified);
    await audit(req, req.body.verified ? 'JEEVAMITRA_VET_VERIFIED' : 'JEEVAMITRA_VET_UNVERIFIED', 'JeevaMitraUser', user.uid, {
      name: user.name,
      ...result,
    });
    sendSuccess(res, { user: { ...user, isVerified: req.body.verified }, ...result });
  }),
);

jeevamitraRouter.post(
  `${base}/users/:uid/account`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, ACCOUNTS),
  validate({ params: uidParams, body: z.object({ disabled: z.boolean() }) }),
  wrap(async (req, res) => {
    const user = await store.getUser(req.params.uid!);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'JeevaMitra user not found.');
    await store.setAccountDisabled(user.uid, req.body.disabled);
    await audit(req, req.body.disabled ? 'JEEVAMITRA_ACCOUNT_DISABLED' : 'JEEVAMITRA_ACCOUNT_ENABLED', 'JeevaMitraUser', user.uid, {
      name: user.name,
      role: user.role,
    });
    sendSuccess(res, { uid: user.uid, disabled: req.body.disabled });
  }),
);

jeevamitraRouter.get(
  `${base}/alerts`,
  validate({ query: alertsQuery }),
  wrap(async (req, res) => {
    const q = alertsQuery.parse(req.query);
    sendSuccess(res, { alerts: await store.listAlerts({ activeOnly: q.activeOnly === 'true', limit: q.limit }) });
  }),
);

jeevamitraRouter.post(
  `${base}/alerts/:id/status`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: idParams, body: z.object({ active: z.boolean() }) }),
  wrap(async (req, res) => {
    const found = await store.setAlertActive(req.params.id!, req.body.active);
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Disease alert not found.');
    await audit(req, req.body.active ? 'JEEVAMITRA_ALERT_REACTIVATED' : 'JEEVAMITRA_ALERT_DEACTIVATED', 'DiseaseAlert', req.params.id!, {});
    sendSuccess(res, { id: req.params.id, active: req.body.active });
  }),
);
