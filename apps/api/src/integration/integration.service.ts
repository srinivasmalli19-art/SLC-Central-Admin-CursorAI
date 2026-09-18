import { randomUUID } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AdapterCapability,
  ApplicationIntegrationDto,
  ConfigureIntegrationInput,
  ConnectionStatus,
  ConnectionTestResult,
  CredentialReferenceDto,
  IntegrationEnvironment,
  IntegrationErrorCode,
} from '@slc/shared';

import { requirePrisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../lib/logger.js';
import { AdapterRegistry, defaultAdapterRegistry } from './adapter/registry.js';
import type { AdapterContext, ResolvedCredentialMap } from './adapter/types.js';
import {
  CredentialResolver,
  EnvCredentialResolver,
} from './credentials/resolver.js';
import { normalizeError } from './errors.js';
import { CircuitBreaker, withRetry, withTimeout, type RetryOptions } from './policies.js';
import { runtimeIntegrationEnvironment } from './runtimeEnv.js';
import { assertAllowedOutboundUrl } from './ssrf.js';

const DEFAULT_TIMEOUT_MS = 5_000;

type IntegrationRow = Prisma.ApplicationIntegrationGetPayload<{
  include: { credentialReferences: true };
}>;

function mapConnectionStatusForError(code: IntegrationErrorCode): ConnectionStatus {
  if (code === 'NOT_SUPPORTED') return 'NOT_APPLICABLE';
  if (['TIMEOUT', 'UPSTREAM_5XX', 'RATE_LIMITED', 'NETWORK', 'CIRCUIT_OPEN'].includes(code)) {
    return 'DEGRADED';
  }
  return 'DISCONNECTED';
}

export interface IntegrationServiceOptions {
  prisma?: PrismaClient;
  registry?: AdapterRegistry;
  resolver?: CredentialResolver;
  runtimeEnv?: IntegrationEnvironment;
  egressAllowlist?: string[];
  retry?: RetryOptions;
  circuitBreakerFactory?: () => CircuitBreaker;
}

/**
 * The Integration Layer boundary. Owns integration configuration, the
 * system-authoritative connection status, and (in future connecting phases)
 * adapter execution wrapped with timeout/retry/circuit-breaker policies.
 *
 * Phase 4: no real adapters are registered, so real applications cannot reach
 * CONNECTED. All external work is mediated here; the core never calls adapters
 * directly.
 */
export class IntegrationService {
  private readonly registry: AdapterRegistry;
  private readonly resolver: CredentialResolver;
  private readonly egressAllowlist: string[];
  private readonly retry: RetryOptions;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly breakerFactory: () => CircuitBreaker;
  private readonly forcedRuntimeEnv?: IntegrationEnvironment;

  constructor(options: IntegrationServiceOptions = {}) {
    this.registry = options.registry ?? defaultAdapterRegistry;
    this.resolver = options.resolver ?? new EnvCredentialResolver();
    this.egressAllowlist =
      options.egressAllowlist ??
      (process.env.INTEGRATION_EGRESS_ALLOWLIST?.split(',').map((h) => h.trim()).filter(Boolean) ??
        []);
    this.retry = options.retry ?? { retries: 2, baseDelayMs: 200, factor: 2, jitter: true };
    this.breakerFactory =
      options.circuitBreakerFactory ??
      (() => new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 }));
    this.forcedRuntimeEnv = options.runtimeEnv;
  }

  private get prisma(): PrismaClient {
    return requirePrisma();
  }

  private runtimeEnv(): IntegrationEnvironment {
    return this.forcedRuntimeEnv ?? runtimeIntegrationEnvironment();
  }

  private toCredentialDto(ref: IntegrationRow['credentialReferences'][number]): CredentialReferenceDto {
    return {
      id: ref.id,
      name: ref.name,
      provider: ref.provider,
      refKey: ref.refKey,
      environment: ref.environment,
      scopes: ref.scopes,
      version: ref.version,
      status: ref.status,
      createdAt: ref.createdAt.toISOString(),
      updatedAt: ref.updatedAt.toISOString(),
      rotatedAt: ref.rotatedAt?.toISOString() ?? null,
    };
  }

  private toDto(row: IntegrationRow): ApplicationIntegrationDto {
    return {
      id: row.id,
      applicationId: row.applicationId,
      environment: row.environment,
      adapterType: row.adapterType,
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      connectionStatus: row.connectionStatus,
      capabilities: row.capabilities as AdapterCapability[],
      timeoutMs: row.timeoutMs,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastError: row.lastError,
      credentialReferences: row.credentialReferences.map((r) => this.toCredentialDto(r)),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async event(
    applicationIntegrationId: string,
    type: Prisma.IntegrationEventCreateInput['type'],
    data: { correlationId?: string; outcome?: string; detail?: string; latencyMs?: number } = {},
  ): Promise<void> {
    await this.prisma.integrationEvent.create({
      data: { applicationIntegrationId, type, ...data },
    });
  }

  private async assertApplicationExists(applicationId: string): Promise<void> {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) {
      throw new AppError(404, 'NOT_FOUND', 'Application not found.');
    }
  }

  async listIntegrations(applicationId: string): Promise<ApplicationIntegrationDto[]> {
    await this.assertApplicationExists(applicationId);
    const rows = await this.prisma.applicationIntegration.findMany({
      where: { applicationId },
      include: { credentialReferences: true },
      orderBy: { environment: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getIntegration(
    applicationId: string,
    environment: IntegrationEnvironment,
  ): Promise<ApplicationIntegrationDto> {
    const row = await this.prisma.applicationIntegration.findUnique({
      where: { applicationId_environment: { applicationId, environment } },
      include: { credentialReferences: true },
    });
    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Integration not configured for this environment.');
    }
    return this.toDto(row);
  }

  /**
   * Create/update integration configuration. Never accepts or sets a live
   * connection status: it only derives NOT_CONFIGURED/CONFIGURED from config.
   */
  async configureIntegration(
    applicationId: string,
    environment: IntegrationEnvironment,
    input: ConfigureIntegrationInput,
  ): Promise<ApplicationIntegrationDto> {
    await this.assertApplicationExists(applicationId);

    const existing = await this.prisma.applicationIntegration.findUnique({
      where: { applicationId_environment: { applicationId, environment } },
    });

    const adapterType =
      input.adapterType !== undefined ? input.adapterType : (existing?.adapterType ?? null);
    const enabled = input.enabled !== undefined ? input.enabled : (existing?.enabled ?? false);
    const baseUrl = input.baseUrl !== undefined ? input.baseUrl : (existing?.baseUrl ?? null);
    const timeoutMs = input.timeoutMs !== undefined ? input.timeoutMs : (existing?.timeoutMs ?? null);

    // Config-derived status only. Live states are produced solely by testConnection.
    const liveStatuses: ConnectionStatus[] = ['TESTING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED'];
    let connectionStatus: ConnectionStatus = adapterType ? 'CONFIGURED' : 'NOT_CONFIGURED';
    if (existing && liveStatuses.includes(existing.connectionStatus)) {
      // Preserve a previously derived live status unless configuration was removed.
      connectionStatus = adapterType ? existing.connectionStatus : 'NOT_CONFIGURED';
    }

    const row = await this.prisma.applicationIntegration.upsert({
      where: { applicationId_environment: { applicationId, environment } },
      update: { adapterType, enabled, baseUrl, timeoutMs, connectionStatus },
      create: { applicationId, environment, adapterType, enabled, baseUrl, timeoutMs, connectionStatus },
      include: { credentialReferences: true },
    });

    if (input.credentialReferences !== undefined) {
      const names = input.credentialReferences.map((c) => c.name);
      await this.prisma.credentialReference.deleteMany({
        where: { applicationIntegrationId: row.id, name: { notIn: names.length ? names : ['__none__'] } },
      });
      for (const ref of input.credentialReferences) {
        await this.prisma.credentialReference.upsert({
          where: { applicationIntegrationId_name: { applicationIntegrationId: row.id, name: ref.name } },
          update: {
            provider: ref.provider ?? 'ENV',
            refKey: ref.refKey,
            environment: ref.environment,
            scopes: ref.scopes ?? [],
            status: ref.status ?? 'ACTIVE',
          },
          create: {
            applicationIntegrationId: row.id,
            name: ref.name,
            provider: ref.provider ?? 'ENV',
            refKey: ref.refKey,
            environment: ref.environment,
            scopes: ref.scopes ?? [],
            status: ref.status ?? 'ACTIVE',
          },
        });
      }
      await this.event(row.id, 'CREDENTIAL_REFERENCE_UPDATED', { outcome: 'info' });
    }

    await this.event(row.id, 'CONFIG_UPDATED', { outcome: 'info' });

    return this.getIntegration(applicationId, environment);
  }

  getCapabilities(adapterType: string | null): AdapterCapability[] {
    const adapter = this.registry.get(adapterType);
    return adapter ? adapter.describeCapabilities() : [];
  }

  private breakerFor(id: string): CircuitBreaker {
    let breaker = this.breakers.get(id);
    if (!breaker) {
      breaker = this.breakerFactory();
      this.breakers.set(id, breaker);
    }
    return breaker;
  }

  /**
   * Run a real (mock, in Phase 4) connection validation and set the
   * system-authoritative connection status. Never contacts an external system
   * in Phase 4 because only mock/noop adapters are registered.
   */
  async testConnection(
    applicationId: string,
    environment: IntegrationEnvironment,
  ): Promise<ConnectionTestResult> {
    const dto = await this.getIntegration(applicationId, environment); // 404 if unconfigured
    const correlationId = randomUUID();
    const runtimeEnv = this.runtimeEnv();

    // Kill switch: a disabled integration is never operated.
    if (!dto.enabled) {
      return this.fail(dto.id, correlationId, 'CONFIG_INVALID', 'Integration is disabled.', 'CONFIGURED');
    }

    const adapter = this.registry.get(dto.adapterType);
    if (!adapter) {
      // No adapter registered (e.g. a real external type in Phase 4) — cannot connect.
      return this.fail(
        dto.id,
        correlationId,
        'NOT_SUPPORTED',
        `No adapter is registered for type "${dto.adapterType ?? 'null'}".`,
        'NOT_APPLICABLE',
      );
    }

    await this.setStatus(dto.id, 'TESTING', { lastTestedAt: new Date() });
    await this.event(dto.id, 'CONNECTION_TEST_STARTED', { correlationId, outcome: 'info' });
    const startedAt = Date.now();

    try {
      // Resolve credential references (env-pinned) — values never logged.
      const credentials = await this.resolveCredentials(runtimeEnv, dto.id);

      // SSRF/egress guard for any configured outbound base URL.
      if (dto.baseUrl) {
        assertAllowedOutboundUrl(dto.baseUrl, this.egressAllowlist);
      }

      const ctx: Omit<AdapterContext, 'signal'> = {
        correlationId,
        environment: runtimeEnv,
        baseUrl: dto.baseUrl,
        timeoutMs: dto.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        credentials,
      };

      const breaker = this.breakerFor(dto.id);
      await breaker.exec(() =>
        withRetry(
          () => withTimeout((signal) => adapter.validateConnection({ ...ctx, signal }), ctx.timeoutMs),
          this.retry,
        ),
      );

      const capabilities = adapter.describeCapabilities();
      const row = await this.prisma.applicationIntegration.update({
        where: { id: dto.id },
        data: { connectionStatus: 'CONNECTED', capabilities, lastError: null, lastTestedAt: new Date() },
        include: { credentialReferences: true },
      });
      await this.event(dto.id, 'CONNECTION_TEST_SUCCEEDED', {
        correlationId,
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
      });
      return {
        connectionStatus: row.connectionStatus,
        ok: true,
        code: null,
        message: 'Connection validated.',
        capabilities: row.capabilities as AdapterCapability[],
        correlationId,
      };
    } catch (error) {
      const err = normalizeError(error);
      return this.fail(dto.id, correlationId, err.code, err.message, mapConnectionStatusForError(err.code), startedAt);
    }
  }

  private async resolveCredentials(
    runtimeEnv: IntegrationEnvironment,
    integrationId: string,
  ): Promise<ResolvedCredentialMap> {
    const refs = await this.prisma.credentialReference.findMany({
      where: { applicationIntegrationId: integrationId },
    });
    const map: ResolvedCredentialMap = {};
    for (const ref of refs) {
      const resolved = await this.resolver.resolve(
        {
          name: ref.name,
          provider: ref.provider,
          refKey: ref.refKey,
          environment: ref.environment,
          scopes: ref.scopes,
          status: ref.status,
        },
        runtimeEnv,
      );
      map[ref.name] = resolved;
      // Audit the ACCESS, never the value.
      await this.event(integrationId, 'CREDENTIAL_ACCESSED', {
        outcome: 'success',
        detail: `credential:${ref.name}`,
      });
    }
    return map;
  }

  private async setStatus(
    id: string,
    connectionStatus: ConnectionStatus,
    extra: { lastTestedAt?: Date; lastError?: string | null } = {},
  ): Promise<void> {
    await this.prisma.applicationIntegration.update({
      where: { id },
      data: { connectionStatus, ...extra },
    });
  }

  private async fail(
    id: string,
    correlationId: string,
    code: IntegrationErrorCode,
    message: string,
    status: ConnectionStatus,
    startedAt?: number,
  ): Promise<ConnectionTestResult> {
    await this.setStatus(id, status, { lastError: `${code}: ${message}` });
    await this.event(id, 'CONNECTION_TEST_FAILED', {
      correlationId,
      outcome: 'failure',
      detail: code,
      latencyMs: startedAt ? Date.now() - startedAt : undefined,
    });
    // Log without secrets.
    logger.warn({ integrationId: id, code, correlationId }, 'integration connection test failed');
    return { connectionStatus: status, ok: false, code, message, capabilities: [], correlationId };
  }
}

/** Default process-wide integration service. */
export const integrationService = new IntegrationService();
