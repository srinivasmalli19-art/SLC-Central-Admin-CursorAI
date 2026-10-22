import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../../errors/AppError.js';
import { sendSuccess } from '../../../http/responses.js';
import { requireAuth } from '../../../middleware/requireAuth.js';
import { requireAppRole } from '../../../middleware/requirePermission.js';
import { validate } from '../../../middleware/validate.js';
import { writeAuditLog } from '../../audit/auditLog.service.js';
import { NEARSIP_CLIENT_ID, SupabaseNearSipStore, type NearSipStore } from './nearsip.store.js';

/**
 * NearSip administration from Central Admin (replaces the app's old in-app
 * admin with its hardcoded password). SLC role for `nearsip-admin`:
 * viewer = read, admin = places + reviews, super_admin = also disable users.
 */
const READ = ['viewer', 'manager', 'super_admin'] as const;
const MANAGE = ['manager', 'super_admin'] as const;
const ACCOUNTS = ['super_admin'] as const;

let store: NearSipStore = new SupabaseNearSipStore();
/** Test hook. */
export function setNearSipStore(next: NearSipStore): void {
  store = next;
}

const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res).catch(next);
};

const idParams = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/) });
const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(100).optional(),
});
const placeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['drink', 'food', 'both', 'hotspot']),
    address: z.string().trim().max(500).nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    rating: z.number().min(0).max(5).nullable(),
    is_hotspot: z.boolean(),
    is_verified: z.boolean(),
    is_popular: z.boolean(),
  })
  .strict();

function audit(req: Request, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  return writeAuditLog({
    action,
    actorId: req.admin!.id,
    actorEmail: req.admin!.email,
    targetType,
    targetId,
    metadata: { app: NEARSIP_CLIENT_ID, ...metadata },
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  });
}

export const nearsipRouter = Router();
const base = '/apps/nearsip';
nearsipRouter.use(base, requireAuth, requireAppRole(NEARSIP_CLIENT_ID, READ));

nearsipRouter.get(`${base}/summary`, wrap(async (_req, res) => sendSuccess(res, await store.summary())));

nearsipRouter.get(
  `${base}/places`,
  validate({ query: page }),
  wrap(async (req, res) => sendSuccess(res, await store.listPlaces(page.parse(req.query)))),
);

nearsipRouter.post(
  `${base}/places`,
  requireAppRole(NEARSIP_CLIENT_ID, MANAGE),
  validate({ body: placeSchema }),
  wrap(async (req, res) => {
    const place = await store.createPlace(req.body);
    await audit(req, 'NEARSIP_PLACE_CREATED', 'Place', String(place.id ?? ''), { name: req.body.name });
    sendSuccess(res, { place }, 201);
  }),
);

nearsipRouter.patch(
  `${base}/places/:id`,
  requireAppRole(NEARSIP_CLIENT_ID, MANAGE),
  validate({ params: idParams, body: placeSchema.partial().strict() }),
  wrap(async (req, res) => {
    const place = await store.updatePlace(req.params.id!, req.body);
    if (!place) throw new AppError(404, 'NOT_FOUND', 'Place not found.');
    await audit(req, 'NEARSIP_PLACE_UPDATED', 'Place', req.params.id!, { fields: Object.keys(req.body) });
    sendSuccess(res, { place });
  }),
);

nearsipRouter.delete(
  `${base}/places/:id`,
  requireAppRole(NEARSIP_CLIENT_ID, MANAGE),
  validate({ params: idParams }),
  wrap(async (req, res) => {
    if (!(await store.deletePlace(req.params.id!))) throw new AppError(404, 'NOT_FOUND', 'Place not found.');
    await audit(req, 'NEARSIP_PLACE_DELETED', 'Place', req.params.id!);
    sendSuccess(res, { deleted: true });
  }),
);

nearsipRouter.get(
  `${base}/reviews`,
  validate({ query: page }),
  wrap(async (req, res) => sendSuccess(res, await store.listReviews(page.parse(req.query)))),
);

nearsipRouter.delete(
  `${base}/reviews/:id`,
  requireAppRole(NEARSIP_CLIENT_ID, MANAGE),
  validate({ params: idParams }),
  wrap(async (req, res) => {
    if (!(await store.deleteReview(req.params.id!))) throw new AppError(404, 'NOT_FOUND', 'Review not found.');
    await audit(req, 'NEARSIP_REVIEW_DELETED', 'Review', req.params.id!);
    sendSuccess(res, { deleted: true });
  }),
);

nearsipRouter.get(
  `${base}/users`,
  validate({ query: page }),
  wrap(async (req, res) => sendSuccess(res, await store.listUsers(page.parse(req.query)))),
);

nearsipRouter.post(
  `${base}/users/:id/account`,
  requireAppRole(NEARSIP_CLIENT_ID, ACCOUNTS),
  validate({ params: idParams, body: z.object({ disabled: z.boolean() }) }),
  wrap(async (req, res) => {
    await store.setUserDisabled(req.params.id!, req.body.disabled);
    await audit(req, req.body.disabled ? 'NEARSIP_ACCOUNT_DISABLED' : 'NEARSIP_ACCOUNT_ENABLED', 'NearSipUser', req.params.id!);
    sendSuccess(res, { id: req.params.id, disabled: req.body.disabled });
  }),
);
