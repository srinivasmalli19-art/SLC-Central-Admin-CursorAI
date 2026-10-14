import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '@slc/shared';

import { AppError } from '../errors/AppError.js';
import { hasAppRole, hasPermission } from '../modules/auth/permissions.js';

/**
 * Authorization middleware factory.
 *
 * Produces middleware that authorizes a request only if the authenticated
 * administrator holds the required permission. Authorization logic lives here
 * (centralized) rather than being duplicated across controllers. This is the
 * authoritative check — frontend permission gating is UX only.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      return;
    }
    if (!hasPermission(req.admin, permission)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}

/** Authorize when the admin holds ANY of the given permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      return;
    }
    if (!permissions.some((p) => hasPermission(req.admin!, p))) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}

/**
 * Authorize when the admin holds one of `roles` in the given SLC app (from
 * their SLC sign-in). Used for managing an app's own data from Central Admin.
 */
export function requireAppRole(clientId: string, roles: readonly string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
      return;
    }
    if (!hasAppRole(req.admin, clientId, roles)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have access to this app. Ask a Super Admin to grant you a role for it.'));
      return;
    }
    next();
  };
}
