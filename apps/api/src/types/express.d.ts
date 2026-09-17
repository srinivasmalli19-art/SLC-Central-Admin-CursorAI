import type { ResolvedAdmin } from '../modules/auth/permissions.js';

declare global {
  namespace Express {
    interface Request {
      /** The authenticated administrator, attached by `requireAuth`. */
      admin?: ResolvedAdmin;
      /** The active session id, attached by `requireAuth`. */
      sessionId?: string;
      /** The raw session token from the cookie, attached by `requireAuth`. */
      sessionToken?: string;
    }
  }
}

export {};
