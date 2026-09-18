import type { AdapterCapability } from '@slc/shared';

import { IntegrationError } from '../errors.js';
import type { AdapterContext, ApplicationAdapter, ConnectionInfo } from './types.js';

/**
 * Adapter for registry-only applications that have no live backend to integrate
 * with (e.g. static sites, on-device apps). It advertises no capabilities and
 * rejects connection attempts as not applicable. Performs no I/O.
 */
export class NoopAdapter implements ApplicationAdapter {
  readonly type = 'noop';

  describeCapabilities(): AdapterCapability[] {
    return [];
  }

  async validateConnection(_ctx: AdapterContext): Promise<ConnectionInfo> {
    throw new IntegrationError(
      'NOT_SUPPORTED',
      'This application is registry-only and has no live integration.',
    );
  }
}
