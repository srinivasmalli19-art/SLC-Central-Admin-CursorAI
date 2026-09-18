import type { IntegrationEnvironment } from '@slc/shared';

import { config } from '../config/env.js';

/**
 * Map the validated SERVER runtime environment to an integration environment.
 * This is the ONLY source of truth for credential resolution — a request/path
 * parameter can never override it. `development` and `test` both resolve to the
 * DEVELOPMENT credential namespace.
 */
export function runtimeIntegrationEnvironment(): IntegrationEnvironment {
  switch (config.nodeEnv) {
    case 'production':
      return 'PRODUCTION';
    case 'staging':
      return 'STAGING';
    default:
      return 'DEVELOPMENT';
  }
}
