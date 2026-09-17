import type { Prisma } from '@prisma/client';
import type {
  Application as ApplicationDto,
  ApplicationListQuery,
  ApplicationStats,
  CreateApplicationInput,
  PaginatedResult,
  UpdateApplicationInput,
} from '@slc/shared';

import { requirePrisma } from '../../db/prisma.js';
import { AppError } from '../../errors/AppError.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

type ApplicationRow = Prisma.ApplicationGetPayload<Record<string, never>>;

function toDto(app: ApplicationRow): ApplicationDto {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    platform: app.platform,
    frontendTechnology: app.frontendTechnology,
    backendTechnology: app.backendTechnology,
    databaseTechnology: app.databaseTechnology,
    authenticationTechnology: app.authenticationTechnology,
    repositoryUrl: app.repositoryUrl,
    productionUrl: app.productionUrl,
    stagingUrl: app.stagingUrl,
    environment: app.environment,
    integrationType: app.integrationType,
    adapterType: app.adapterType,
    integrationStatus: app.integrationStatus,
    status: app.status,
    version: app.version,
    healthCheckEnabled: app.healthCheckEnabled,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

export async function listApplications(
  query: ApplicationListQuery,
): Promise<PaginatedResult<ApplicationDto>> {
  const prisma = requirePrisma();

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Prisma.ApplicationWhereInput = {};
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  if (query.status) where.status = query.status;
  if (query.integrationType) where.integrationType = query.integrationType;
  if (query.integrationStatus) where.integrationStatus = query.integrationStatus;
  if (query.platform) where.platform = { contains: query.platform, mode: 'insensitive' };

  const sortBy = query.sortBy ?? 'name';
  const sortDir = query.sortDir ?? 'asc';
  const orderBy: Prisma.ApplicationOrderByWithRelationInput = { [sortBy]: sortDir };

  const [total, rows] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map(toDto),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getApplication(id: string): Promise<ApplicationDto> {
  const prisma = requirePrisma();
  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) {
    throw new AppError(404, 'NOT_FOUND', 'Application not found.');
  }
  return toDto(app);
}

export async function createApplication(input: CreateApplicationInput): Promise<ApplicationDto> {
  const prisma = requirePrisma();

  const existing = await prisma.application.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw new AppError(409, 'SLUG_TAKEN', 'An application with this slug already exists.');
  }

  const created = await prisma.application.create({ data: input });
  return toDto(created);
}

export async function updateApplication(
  id: string,
  input: UpdateApplicationInput,
): Promise<ApplicationDto> {
  const prisma = requirePrisma();
  const existing = await prisma.application.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Application not found.');
  }
  const updated = await prisma.application.update({ where: { id }, data: input });
  return toDto(updated);
}

export async function getApplicationStats(): Promise<ApplicationStats> {
  const prisma = requirePrisma();
  const [total, production, development, registryOnly, pendingIntegrations] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({ where: { status: 'PRODUCTION' } }),
    prisma.application.count({ where: { status: 'DEVELOPMENT' } }),
    prisma.application.count({ where: { integrationType: 'REGISTRY_ONLY' } }),
    prisma.application.count({
      where: {
        integrationType: { notIn: ['REGISTRY_ONLY', 'NONE'] },
        integrationStatus: { notIn: ['CONNECTED', 'NOT_APPLICABLE'] },
      },
    }),
  ]);
  return { total, production, development, registryOnly, pendingIntegrations };
}
