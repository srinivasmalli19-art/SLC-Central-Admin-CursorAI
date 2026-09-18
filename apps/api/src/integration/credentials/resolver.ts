import type { CredentialProvider, CredentialStatus, IntegrationEnvironment } from '@slc/shared';

import { IntegrationError } from '../errors.js';
import type { ResolvedCredential } from '../adapter/types.js';

/** Minimal shape needed to resolve a credential (a reference, not a secret). */
export interface CredentialRefLike {
  name: string;
  provider: CredentialProvider;
  refKey: string;
  environment: IntegrationEnvironment;
  scopes: string[];
  status: CredentialStatus;
}

/**
 * Resolves credential REFERENCES to in-memory secret material at call time.
 *
 * Enforces the environment security rule: the credential's environment MUST
 * equal the server runtime environment. A development/staging server can never
 * resolve production credentials regardless of any request parameter. Resolved
 * values are returned only to the Integration Layer and are never logged or
 * returned by any API.
 */
export interface CredentialResolver {
  resolve(ref: CredentialRefLike, runtimeEnv: IntegrationEnvironment): Promise<ResolvedCredential>;
}

function guard(ref: CredentialRefLike, runtimeEnv: IntegrationEnvironment): void {
  if (ref.status !== 'ACTIVE') {
    throw new IntegrationError('CREDENTIAL_REVOKED', `Credential "${ref.name}" is not active.`);
  }
  if (ref.environment !== runtimeEnv) {
    throw new IntegrationError(
      'ENVIRONMENT_MISMATCH',
      `Credential "${ref.name}" is scoped to ${ref.environment} but runtime is ${runtimeEnv}.`,
    );
  }
}

/**
 * Default resolver backed by environment variables (the only provider wired in
 * Phase 4). `refKey` is a NON-secret variable name; the secret value lives only
 * in the process environment, never in the database or repository.
 */
export class EnvCredentialResolver implements CredentialResolver {
  async resolve(
    ref: CredentialRefLike,
    runtimeEnv: IntegrationEnvironment,
  ): Promise<ResolvedCredential> {
    guard(ref, runtimeEnv);
    if (ref.provider !== 'ENV') {
      throw new IntegrationError(
        'NOT_SUPPORTED',
        `Credential provider ${ref.provider} is not implemented in Phase 4.`,
      );
    }
    const value = process.env[ref.refKey];
    if (!value) {
      throw new IntegrationError('CONFIG_INVALID', `Missing credential material for "${ref.name}".`);
    }
    return { value, scopes: ref.scopes };
  }
}

/**
 * In-memory resolver for tests. Honors the same environment/status guards but
 * reads values from an injected map instead of the process environment.
 */
export class FakeCredentialResolver implements CredentialResolver {
  constructor(private readonly values: Record<string, string> = {}) {}

  async resolve(
    ref: CredentialRefLike,
    runtimeEnv: IntegrationEnvironment,
  ): Promise<ResolvedCredential> {
    guard(ref, runtimeEnv);
    const value = this.values[ref.refKey];
    if (!value) {
      throw new IntegrationError('CONFIG_INVALID', `Missing credential material for "${ref.name}".`);
    }
    return { value, scopes: ref.scopes };
  }
}
