import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../../errors/AppError.js';
import { sendSuccess } from '../../../http/responses.js';
import { requireAuth } from '../../../middleware/requireAuth.js';
import { requireAppRole } from '../../../middleware/requirePermission.js';
import { validate } from '../../../middleware/validate.js';
import { writeAuditLog } from '../../audit/auditLog.service.js';
import { findBridgeApp } from '../../bridge/firebaseBridge.service.js';
import {
  FirestorePasunestamStore,
  PASUNESTAM_CLIENT_ID,
  SLC_STAFF_UID_PREFIX,
  type PasunestamStore,
} from './pasunestam.store.js';

/**
 * Pasunestam administration from Central Admin. Access comes from the admin's
 * SLC role for `pasunestam-admin` (the same roles that sign staff in to the
 * Pasunestam site itself):
 *
 * - editor  = review vet case submissions, cancel certificates
 * - manager = also vet accounts, certificate templates, scheme forms and
 *             scheme applications (farmers' phone numbers)
 */
const MODERATE = ['editor', 'manager'] as const;
const MANAGE = ['manager'] as const;

let store: PasunestamStore = new FirestorePasunestamStore();
/** Test hook. */
export function setPasunestamStore(next: PasunestamStore): void {
  store = next;
}

function requireConnected(_req: Request, _res: Response, next: NextFunction): void {
  if (!findBridgeApp(PASUNESTAM_CLIENT_ID)) {
    next(new AppError(503, 'APP_NOT_CONNECTED', 'Pasunestam is not connected (no service account configured).'));
    return;
  }
  next();
}

const wrap = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
  handler(req, res).catch(next);
};

const docId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const idParams = z.object({ id: docId });
const uidParams = z.object({ uid: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) });
const casesQuery = z.object({
  status: z.enum(['submitted', 'published', 'rejected']).default('submitted'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const certificatesQuery = z.object({
  number: z.string().trim().min(1).max(64).optional(),
  status: z.enum(['draft', 'issued', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const vetsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.string().max(128).optional(),
});
const applicationsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

function audit(req: Request, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  return writeAuditLog({
    action,
    actorId: req.admin!.id,
    actorEmail: req.admin!.email,
    targetType,
    targetId,
    metadata: { app: PASUNESTAM_CLIENT_ID, ...metadata },
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  });
}

/** Shown in Pasunestam as who reviewed / cancelled. */
const actorLabel = (req: Request) => `SLC Central Admin: ${req.admin!.email}`;

export const pasunestamRouter = Router();
const base = '/apps/pasunestam';
pasunestamRouter.use(base, requireAuth, requireAppRole(PASUNESTAM_CLIENT_ID, MODERATE), requireConnected);

pasunestamRouter.get(`${base}/summary`, wrap(async (_req, res) => sendSuccess(res, await store.summary())));

// --- Case submissions (vets submit; only published cases are public) ----------

pasunestamRouter.get(
  `${base}/cases`,
  validate({ query: casesQuery }),
  wrap(async (req, res) => {
    const q = casesQuery.parse(req.query);
    sendSuccess(res, { cases: await store.listCases(q) });
  }),
);

pasunestamRouter.post(
  `${base}/cases/:id/review`,
  validate({ params: idParams, body: z.object({ decision: z.enum(['published', 'rejected']) }) }),
  wrap(async (req, res) => {
    const updated = await store.setCaseStatus(req.params.id!, req.body.decision, actorLabel(req));
    if (!updated) throw new AppError(404, 'NOT_FOUND', 'Case not found.');
    await audit(req, req.body.decision === 'published' ? 'PASUNESTAM_CASE_PUBLISHED' : 'PASUNESTAM_CASE_REJECTED', 'PasunestamCase', updated.id, {
      title: updated.title,
      submitter: updated.submitterName,
    });
    sendSuccess(res, { case: updated });
  }),
);

// --- Certificates ---------------------------------------------------------------

pasunestamRouter.get(
  `${base}/certificates`,
  validate({ query: certificatesQuery }),
  wrap(async (req, res) => {
    const q = certificatesQuery.parse(req.query);
    sendSuccess(res, { certificates: await store.findCertificates(q) });
  }),
);

pasunestamRouter.post(
  `${base}/certificates/:id/cancel`,
  validate({ params: idParams, body: z.object({ reason: z.string().trim().min(3).max(500) }) }),
  wrap(async (req, res) => {
    const result = await store.cancelCertificate(req.params.id!, req.body.reason, actorLabel(req));
    if (result.outcome === 'not_found') throw new AppError(404, 'NOT_FOUND', 'Certificate not found.');
    if (result.outcome === 'not_issued') {
      throw new AppError(409, 'NOT_ISSUED', `Only issued certificates can be cancelled (this one is ${result.status}).`);
    }
    await audit(req, 'PASUNESTAM_CERTIFICATE_CANCELLED', 'PasunestamCertificate', result.certificate.id, {
      number: result.certificate.number,
      reason: req.body.reason,
    });
    sendSuccess(res, { certificate: result.certificate });
  }),
);

// --- Templates (manager) ----------------------------------------------------------

pasunestamRouter.get(`${base}/templates`, wrap(async (_req, res) => sendSuccess(res, { templates: await store.listTemplates() })));

pasunestamRouter.post(
  `${base}/templates/:id/published`,
  requireAppRole(PASUNESTAM_CLIENT_ID, MANAGE),
  validate({ params: idParams, body: z.object({ published: z.boolean() }) }),
  wrap(async (req, res) => {
    const updated = await store.setTemplatePublished(req.params.id!, req.body.published);
    if (!updated) throw new AppError(404, 'NOT_FOUND', 'Certificate template not found.');
    await audit(req, req.body.published ? 'PASUNESTAM_TEMPLATE_PUBLISHED' : 'PASUNESTAM_TEMPLATE_UNPUBLISHED', 'PasunestamTemplate', updated.id, {
      name: updated.name,
    });
    sendSuccess(res, { template: updated });
  }),
);

// --- Scheme forms + applications ---------------------------------------------------

pasunestamRouter.get(`${base}/schemes`, wrap(async (_req, res) => sendSuccess(res, { schemes: await store.listSchemes() })));

pasunestamRouter.delete(
  `${base}/schemes/:id`,
  requireAppRole(PASUNESTAM_CLIENT_ID, MANAGE),
  validate({ params: idParams }),
  wrap(async (req, res) => {
    const removed = await store.deleteScheme(req.params.id!);
    if (!removed) throw new AppError(404, 'NOT_FOUND', 'Scheme form not found.');
    await audit(req, 'PASUNESTAM_SCHEME_REMOVED', 'PasunestamScheme', removed.id, { name: removed.name, fileName: removed.fileName });
    sendSuccess(res, { deleted: true });
  }),
);

pasunestamRouter.get(
  `${base}/scheme-applications`,
  requireAppRole(PASUNESTAM_CLIENT_ID, MANAGE),
  validate({ query: applicationsQuery }),
  wrap(async (req, res) => {
    const q = applicationsQuery.parse(req.query);
    sendSuccess(res, { applications: await store.listSchemeApplications(q.limit) });
  }),
);

// --- Vet accounts (manager) ---------------------------------------------------------

pasunestamRouter.get(
  `${base}/vets`,
  requireAppRole(PASUNESTAM_CLIENT_ID, MANAGE),
  validate({ query: vetsQuery }),
  wrap(async (req, res) => {
    const q = vetsQuery.parse(req.query);
    sendSuccess(res, await store.listVets(q));
  }),
);

pasunestamRouter.post(
  `${base}/vets/:uid/account`,
  requireAppRole(PASUNESTAM_CLIENT_ID, MANAGE),
  validate({ params: uidParams, body: z.object({ disabled: z.boolean() }) }),
  wrap(async (req, res) => {
    const uid = req.params.uid!;
    // Staff accounts (slc:<id>) are managed in Admin access, never here. The
    // uid pattern above already excludes ':'; this keeps the rule explicit.
    if (uid.startsWith(SLC_STAFF_UID_PREFIX)) {
      throw new AppError(422, 'STAFF_ACCOUNT', 'Staff accounts are managed in Admin access.');
    }
    const vet = await store.getVet(uid);
    if (!vet) throw new AppError(404, 'NOT_FOUND', 'Vet not found.');
    await store.setAccountDisabled(uid, req.body.disabled);
    await audit(req, req.body.disabled ? 'PASUNESTAM_VET_DISABLED' : 'PASUNESTAM_VET_ENABLED', 'PasunestamVet', uid, {
      name: vet.fullName,
      registrationNo: vet.registrationNo,
    });
    sendSuccess(res, { uid, disabled: req.body.disabled });
  }),
);
