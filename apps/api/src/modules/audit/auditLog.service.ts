import type { AuditLogEntry, AuditLogQuery, PaginatedResult } from '@slc/shared';
import type { Prisma } from '@prisma/client';

import { getPrisma, requirePrisma } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';

/**
 * Central audit log. Writes are best-effort: a failed audit write is logged but
 * never breaks the action being audited (the structured log line remains the
 * fallback record). Metadata must never contain secrets.
 */

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|credential|authorization|cookie/i;

/** Drop any metadata key that looks like it could carry a secret (defence in depth). */
export function scrubMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || SECRET_KEY_PATTERN.test(key)) {
      continue;
    }
    clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) {
    return;
  }
  try {
    await prisma.auditLog.create({
      data: {
        action: event.action,
        actorId: event.actorId ?? null,
        actorEmail: event.actorEmail ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        metadata: (scrubMetadata(event.metadata) as Prisma.InputJsonValue | undefined) ?? undefined,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error), action: event.action }, 'audit_write_failed');
  }
}

export async function listAuditLogs(query: AuditLogQuery): Promise<PaginatedResult<AuditLogEntry>> {
  const prisma = requirePrisma();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorEmail ? { actorEmail: { contains: query.actorEmail.toLowerCase(), mode: 'insensitive' } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actorId: row.actorId,
      actorEmail: row.actorEmail,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      ipAddress: row.ipAddress,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Distinct action names, for the audit log filter. */
export async function listAuditActions(): Promise<string[]> {
  const prisma = requirePrisma();
  const rows = await prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  return rows.map((row) => row.action);
}
