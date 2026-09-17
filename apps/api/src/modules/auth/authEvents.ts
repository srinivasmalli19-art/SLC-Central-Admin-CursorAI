import type { AuthEventType } from '@slc/shared';

import { logger } from '../../lib/logger.js';

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
 * Phase 2 emits structured, secret-free log lines. Phase 4 will additionally
 * persist these as audit-log rows without changing any call site. This function
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
}
