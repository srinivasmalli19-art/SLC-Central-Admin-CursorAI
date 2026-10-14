import type { AuthEventType } from '@slc/shared';

import { logger } from '../../lib/logger.js';
import { writeAuditLog } from '../audit/auditLog.service.js';

export interface AuthEventContext {
  adminUserId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  /** Non-sensitive extra detail (never secrets, tokens, or passwords). */
  metadata?: Record<string, unknown>;
}

/**
 * Single choke point for authentication events.
 *
 * Emits a structured, secret-free log line and persists the event to the
 * central audit log (`audit_log` table). This function
 * must never receive passwords, tokens, or other secrets.
 */
export function recordAuthEvent(type: AuthEventType, context: AuthEventContext = {}): void {
  logger.info(
    {
      authEvent: type,
      adminUserId: context.adminUserId,
      email: context.email,
      ip: context.ipAddress,
      userAgent: context.userAgent,
      ...context.metadata,
    },
    `auth_event ${type}`,
  );
  // Persist to the central audit log (best-effort, never throws).
  void writeAuditLog({
    action: type,
    actorId: context.adminUserId,
    actorEmail: context.email,
    targetType: 'AdminUser',
    targetId: context.adminUserId,
    metadata: context.metadata,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}
