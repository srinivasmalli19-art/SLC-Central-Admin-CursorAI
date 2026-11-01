import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../../errors/AppError.js';
import { sendSuccess } from '../../../http/responses.js';
import { requireAuth } from '../../../middleware/requireAuth.js';
import { requireAppRole } from '../../../middleware/requirePermission.js';
import { validate } from '../../../middleware/validate.js';
import { writeAuditLog } from '../../audit/auditLog.service.js';
import { hasAppRole } from '../../auth/permissions.js';
import { findBridgeApp } from '../../bridge/firebaseBridge.service.js';
import { DEFAULT_CROPS, DEFAULT_CROP_SETTINGS } from './jeevamitra.cropDefaults.js';
import {
  FirestoreJeevaMitraStore,
  JEEVAMITRA_CLIENT_ID,
  JM_KINDS,
  USER_CONTENT,
  type JeevaMitraStore,
  type JmKind,
} from './jeevamitra.store.js';

/**
 * JeevaMitra administration from Central Admin. Access comes from the admin's
 * SLC role for `jeevamitra-admin`:
 *   viewer      read everything
 *   manager     pause/resume any content; add, edit, delete vets, stories,
 *               videos and crop safety cards
 *   super_admin also delete user posts (lands, alerts, field posts) and
 *               disable/enable accounts
 * Every change is written to the audit log.
 */
const READ = ['viewer', 'manager', 'super_admin'] as const;
const MANAGE = ['manager', 'super_admin'] as const;
const SUPER = ['super_admin'] as const;

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

// ---- validation ---------------------------------------------------------------
const docId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const uidParams = z.object({ uid: z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/) });
const kindParams = z.object({ kind: z.enum(JM_KINDS as unknown as [JmKind, ...JmKind[]]) });
const itemParams = kindParams.extend({ id: docId });
const usersQuery = z.object({
  profileType: z.enum(['livestock', 'land', 'both']).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.string().max(128).optional(),
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: docId.optional(),
});

// Values the app understands (its vet screens and filters use these exact words).
export const VET_SECTORS = ['Government', 'Private'] as const;
export const VET_DESIGNATIONS = ['Veterinary Officer', 'Veterinary Assistant'] as const;
export const VET_SERVICES = ['General Checkup', 'Vaccination', 'First Aid', 'Artificial Insemination', 'Surgery', 'Epidemic Response'] as const;
export const VET_LANGUAGES = ['Telugu', 'English', 'Hindi'] as const;
export const VET_AVAILABILITY = ['Available today', 'Available tomorrow', 'Busy this week'] as const;
const text = (max: number) => z.string().trim().max(max);
const vetBody = z.object({
  name: text(120).min(2),
  sector: z.enum(VET_SECTORS),
  designation: z.enum(VET_DESIGNATIONS),
  services: z.array(z.enum(VET_SERVICES)).max(VET_SERVICES.length).default([]),
  experienceYears: z.number().int().min(0).max(70).default(0),
  languages: z.array(z.enum(VET_LANGUAGES)).min(1).max(3),
  village: text(80).min(1),
  district: text(80).min(1),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits.'),
  rating: z.number().min(1).max(5).nullable().default(null),
  availability: z.enum(VET_AVAILABILITY).default('Available today'),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});

const localized = (max: number) =>
  z.object({ en: text(max).optional(), te: text(max).optional(), hi: text(max).optional() }).strict();
const cropBody = z
  .object({
    emoji: text(8).optional(),
    order: z.number().int().min(0).max(9999).optional(),
    hidden: z.boolean().optional(),
    reviewedBy: text(120).optional(),
    reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    name: localized(60).optional(),
    goodFor: localized(600).optional(),
    risk: localized(1200).optional(),
    precautions: localized(1500).optional(),
  })
  .strict();
const settingsBody = z
  .object({
    sprayWarningDays: z.number().int().min(0).max(365).optional(),
    generalPrecautions: z
      .object({ en: z.array(text(300)).max(15).optional(), te: z.array(text(300)).max(15).optional(), hi: z.array(text(300)).max(15).optional() })
      .strict()
      .optional(),
    callVet: localized(600).optional(),
    disclaimer: localized(600).optional(),
  })
  .strict();

/** Drops empty strings so the app falls back to its built-in text for them. */
function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact).filter((v) => v !== '' && v !== undefined) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c === '' || c === undefined) continue;
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

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

const KIND_LABEL: Record<JmKind, string> = {
  lands: 'Land', alerts: 'DiseaseAlert', vets: 'Vet', stories: 'Story', videos: 'Video', fieldPosts: 'FieldPost',
};

export const jeevamitraRouter = Router();
const base = '/apps/jeevamitra';
jeevamitraRouter.use(base, requireAuth, requireAppRole(JEEVAMITRA_CLIENT_ID, READ), requireConnected);

jeevamitraRouter.get(`${base}/summary`, wrap(async (_req, res) => sendSuccess(res, await store.summary())));

// ---- users --------------------------------------------------------------------
jeevamitraRouter.get(
  `${base}/users`,
  validate({ query: usersQuery }),
  wrap(async (req, res) => {
    const q = usersQuery.parse(req.query);
    sendSuccess(res, await store.listUsers({ profileType: q.profileType, phone: q.phone, limit: q.limit, after: q.after }));
  }),
);

jeevamitraRouter.post(
  `${base}/users/:uid/account`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, SUPER),
  validate({ params: uidParams, body: z.object({ disabled: z.boolean() }) }),
  wrap(async (req, res) => {
    const user = await store.getUser(req.params.uid!);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'JeevaMitra user not found.');
    if (user.disabled === null) throw new AppError(409, 'NO_AUTH_ACCOUNT', 'This person has no sign-in account any more.');
    await store.setAccountDisabled(user.uid, req.body.disabled);
    await audit(req, req.body.disabled ? 'JEEVAMITRA_ACCOUNT_DISABLED' : 'JEEVAMITRA_ACCOUNT_ENABLED', 'JeevaMitraUser', user.uid, {
      name: user.name,
      profileType: user.profileType,
    });
    sendSuccess(res, { uid: user.uid, disabled: req.body.disabled });
  }),
);

// ---- vets (add / edit; pause and delete use the generic content routes) ---------
jeevamitraRouter.get(
  `${base}/vets/:id`,
  validate({ params: z.object({ id: docId }) }),
  wrap(async (req, res) => {
    const vet = await store.getVet(req.params.id!);
    if (!vet) throw new AppError(404, 'NOT_FOUND', 'Vet not found.');
    sendSuccess(res, { vet });
  }),
);

jeevamitraRouter.post(
  `${base}/vets`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ body: vetBody }),
  wrap(async (req, res) => {
    const vet = vetBody.parse(req.body);
    const id = await store.createVet(vet, `slc:${req.admin!.email}`);
    await audit(req, 'JEEVAMITRA_VET_CREATED', 'Vet', id, { name: vet.name });
    sendSuccess(res, { id }, 201);
  }),
);

jeevamitraRouter.put(
  `${base}/vets/:id`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: z.object({ id: docId }), body: vetBody }),
  wrap(async (req, res) => {
    const vet = vetBody.parse(req.body);
    if (!(await store.updateVet(req.params.id!, vet))) throw new AppError(404, 'NOT_FOUND', 'Vet not found.');
    await audit(req, 'JEEVAMITRA_VET_UPDATED', 'Vet', req.params.id!, { name: vet.name });
    sendSuccess(res, { id: req.params.id });
  }),
);

// ---- crop safety cards ------------------------------------------------------------
jeevamitraRouter.get(
  `${base}/crop-guides`,
  wrap(async (_req, res) => {
    const { edits, settings } = await store.listCropGuideEdits();
    sendSuccess(res, { defaults: DEFAULT_CROPS, defaultSettings: DEFAULT_CROP_SETTINGS, edits, settings });
  }),
);

jeevamitraRouter.put(
  `${base}/crop-guides/:id`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: z.object({ id: z.string().regex(/^[a-z0-9_-]{1,64}$/) }), body: cropBody }),
  wrap(async (req, res) => {
    const id = req.params.id!;
    const body = compact(cropBody.parse(req.body));
    const isDefault = DEFAULT_CROPS.some((c) => c.id === id);
    if (!isDefault && !body.name?.en && !body.name?.te && !body.name?.hi) {
      throw new AppError(422, 'NAME_REQUIRED', 'A new crop needs a name in at least one language.');
    }
    await store.saveCropGuide({ id, ...body }, req.admin!.email);
    await audit(req, isDefault ? 'JEEVAMITRA_CROP_GUIDE_EDITED' : 'JEEVAMITRA_CROP_GUIDE_SAVED', 'CropGuide', id, {
      fields: Object.keys(body),
      hidden: body.hidden ?? false,
    });
    sendSuccess(res, { id });
  }),
);

jeevamitraRouter.delete(
  `${base}/crop-guides/:id`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: z.object({ id: z.string().regex(/^[a-z0-9_-]{1,64}$/) }) }),
  wrap(async (req, res) => {
    if (!(await store.deleteCropGuide(req.params.id!))) throw new AppError(404, 'NOT_FOUND', 'No admin edit for this crop.');
    await audit(req, 'JEEVAMITRA_CROP_GUIDE_RESET', 'CropGuide', req.params.id!, {});
    sendSuccess(res, { id: req.params.id });
  }),
);

jeevamitraRouter.put(
  `${base}/crop-guide-settings`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ body: settingsBody }),
  wrap(async (req, res) => {
    const body = compact(settingsBody.parse(req.body));
    await store.saveCropSettings(body, req.admin!.email);
    await audit(req, 'JEEVAMITRA_CROP_SETTINGS_SAVED', 'CropGuideSettings', 'default', { fields: Object.keys(body) });
    sendSuccess(res, { saved: true });
  }),
);

// ---- content: lands, alerts, vets, stories, videos, field posts -------------------
jeevamitraRouter.get(
  `${base}/content/:kind`,
  validate({ params: kindParams, query: pageQuery }),
  wrap(async (req, res) => {
    const q = pageQuery.parse(req.query);
    sendSuccess(res, await store.listItems(req.params.kind as JmKind, { limit: q.limit, after: q.after }));
  }),
);

jeevamitraRouter.post(
  `${base}/content/:kind/:id/visibility`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: itemParams, body: z.object({ hidden: z.boolean() }) }),
  wrap(async (req, res) => {
    const kind = req.params.kind as JmKind;
    const item = await store.getItem(kind, req.params.id!);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    await store.setHidden(kind, item.id, req.body.hidden);
    await audit(req, req.body.hidden ? 'JEEVAMITRA_CONTENT_PAUSED' : 'JEEVAMITRA_CONTENT_RESUMED', KIND_LABEL[kind], item.id, {
      title: item.title,
      ownerId: item.ownerId,
    });
    sendSuccess(res, { id: item.id, hidden: req.body.hidden });
  }),
);

jeevamitraRouter.delete(
  `${base}/content/:kind/:id`,
  requireAppRole(JEEVAMITRA_CLIENT_ID, MANAGE),
  validate({ params: itemParams }),
  wrap(async (req, res) => {
    const kind = req.params.kind as JmKind;
    if (USER_CONTENT.includes(kind) && !hasAppRole(req.admin!, JEEVAMITRA_CLIENT_ID, SUPER)) {
      throw new AppError(403, 'FORBIDDEN', 'Only a JeevaMitra super admin can delete posts made by app users. Pause it instead.');
    }
    const item = await store.getItem(kind, req.params.id!);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const result = await store.deleteItem(kind, item.id);
    await audit(req, 'JEEVAMITRA_CONTENT_DELETED', KIND_LABEL[kind], item.id, { title: item.title, ownerId: item.ownerId, filesDeleted: result.filesDeleted });
    sendSuccess(res, { id: item.id, ...result });
  }),
);
