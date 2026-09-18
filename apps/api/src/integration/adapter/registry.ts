import { config } from '../../config/env.js';
import { SafeHttpClient } from '../http/safeHttpClient.js';
import { MockAdapter } from './mockAdapter.js';
import { NoopAdapter } from './noopAdapter.js';
import { StockManagementAdapter } from './stock-management/stockManagementAdapter.js';
import type { ApplicationAdapter } from './types.js';

/**
 * Registry that maps an `adapterType` to an adapter implementation. The core /
 * Integration Layer resolves adapters only through this registry, so no
 * application-specific code is imported by the core.
 *
 * Phase 4 registers ONLY the safe `mock` and `noop` adapters. Real adapter
 * types (e.g. 'http', 'firebase-admin') are intentionally NOT registered, so a
 * real external application can never reach a CONNECTED state in this phase.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, ApplicationAdapter>();

  register(adapter: ApplicationAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string | null | undefined): ApplicationAdapter | undefined {
    if (!type) return undefined;
    return this.adapters.get(type);
  }

  has(type: string | null | undefined): boolean {
    return Boolean(type) && this.adapters.has(type as string);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

/** Default process registry. */
export const defaultAdapterRegistry = new AdapterRegistry();
defaultAdapterRegistry.register(new MockAdapter());
defaultAdapterRegistry.register(new NoopAdapter());
// Stock Management adapter foundation. Uses the guarded HTTP client with the
// configured egress allow-list, which is fail-closed (empty) by default: no
// real host is reachable until an allow-list entry is explicitly configured in
// a future (approved) phase, so registering it here initiates no connection.
defaultAdapterRegistry.register(
  new StockManagementAdapter(new SafeHttpClient({ allowlist: config.integration.egressAllowlist })),
);
