import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { sendSuccess } from '../../http/responses.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { listAuditActions, listAuditLogs } from './auditLog.service.js';

export const auditRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  action: z.string().min(1).max(100).optional(),
  actorEmail: z.string().min(1).max(200).optional(),
});

auditRouter.get(
  '/audit-logs',
  requireAuth,
  requirePermission('audit_logs.view'),
  validate({ query: listQuery }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, await listAuditLogs(listQuery.parse(req.query)));
    } catch (error) {
      next(error);
    }
  },
);

auditRouter.get(
  '/audit-logs/actions',
  requireAuth,
  requirePermission('audit_logs.view'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, { actions: await listAuditActions() });
    } catch (error) {
      next(error);
    }
  },
);
