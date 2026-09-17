/**
 * Application registry seed data.
 *
 * SOURCE OF TRUTH: docs/SLC-ECOSYSTEM-INVENTORY.md (Phase 0). Only documented
 * facts are used. Anything Phase 0 marked UNKNOWN is stored as `null` (rendered
 * as UNKNOWN in the UI) — never fabricated. No secrets are stored.
 *
 * Unresolved applications (NearSip, jeevamitra-app, Stock Management Android)
 * were not accessible in Phase 0 and are intentionally NOT seeded; they are
 * documented as unresolved in docs/SLC-PHASE-3-APPLICATION-REGISTRY.md.
 *
 * `integrationStatus: PLANNED` denotes a FUTURE intended integration only and
 * must never be treated as connected/operational.
 */
import type { PrismaClient, Prisma } from '@prisma/client';

export const KNOWN_APPLICATIONS: Prisma.ApplicationCreateInput[] = [
  {
    slug: 'slc-vet',
    name: 'SLC Vet',
    description: 'Smart Livestock Care — veterinary and livestock management platform.',
    platform: 'Web',
    frontendTechnology: 'React 18 (Create React App + CRACO)',
    backendTechnology: 'FastAPI (Python 3.12)',
    databaseTechnology: 'MongoDB',
    authenticationTechnology: 'JWT (HS256) + bcrypt',
    repositoryUrl: 'https://github.com/srinivasmalli19-art/slc',
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'API',
    adapterType: 'HTTP/OpenAPI',
    integrationStatus: 'PLANNED',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
  },
  {
    slug: 'stock-management',
    name: 'Stock Management (FieldOps Manager)',
    description: 'Field operations and stock management web application (FieldOps Manager).',
    platform: 'Web',
    frontendTechnology: 'React 18 + Vite',
    backendTechnology: 'Node.js + Express',
    databaseTechnology: 'PostgreSQL (Prisma)',
    authenticationTechnology: 'JWT access + refresh + bcrypt',
    repositoryUrl: 'https://github.com/srinivasmalli19-art/Stock-management-Web',
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'API',
    adapterType: 'HTTP',
    integrationStatus: 'PLANNED',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
  },
  {
    slug: 'pasumithra',
    name: 'Pasumithra',
    description: 'Livestock marketplace (buy, sell and connect).',
    platform: 'Web',
    frontendTechnology: 'Next.js 16 + React 19',
    backendTechnology: 'Next.js server runtime + firebase-admin (server-only)',
    databaseTechnology: 'Firestore',
    authenticationTechnology: 'Firebase Auth (session cookies)',
    repositoryUrl: 'https://github.com/srinivasmalli19-art/pasunestam',
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'FIREBASE_ADMIN',
    adapterType: 'Firebase Admin SDK',
    integrationStatus: 'PLANNED',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
  },
  {
    slug: 'jeevamitra',
    name: 'JeevaMitra',
    description: 'Rural geo-spatial livestock and agricultural ecosystem platform.',
    platform: 'Flutter (Android, iOS, macOS, Web)',
    frontendTechnology: 'Flutter/Dart',
    backendTechnology: 'Firebase + Cloud Functions (Node 20)',
    databaseTechnology: 'Firestore',
    authenticationTechnology: 'Firebase Auth',
    repositoryUrl: 'https://github.com/srinivasmalli19-art/Jeevamitra',
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'FIREBASE_ADMIN',
    adapterType: 'Firebase Admin SDK',
    integrationStatus: 'PLANNED',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
  },
  {
    slug: 'slc-gps-camera',
    name: 'SLC GPS Camera',
    description: 'Android GPS map camera that burns location overlays into photos.',
    platform: 'Flutter (Android)',
    frontendTechnology: 'Flutter/Dart',
    backendTechnology: null,
    databaseTechnology: null,
    authenticationTechnology: null,
    repositoryUrl: 'https://github.com/srinivasmalli19-art/gps_map_camera_pro',
    productionUrl: null,
    stagingUrl: null,
    environment: 'UNKNOWN',
    integrationType: 'REGISTRY_ONLY',
    adapterType: null,
    integrationStatus: 'NOT_APPLICABLE',
    status: 'UNKNOWN',
    version: null,
    healthCheckEnabled: false,
  },
  {
    slug: 'slc-apps-portal',
    name: 'SLC Apps Portal',
    description: 'Marketing site for SLC Technologies and its applications.',
    platform: 'Web (static)',
    frontendTechnology: 'React 19 + Vite',
    backendTechnology: null,
    databaseTechnology: null,
    authenticationTechnology: null,
    repositoryUrl: 'https://github.com/srinivasmalli19-art/SLC-Apps',
    // Documented Phase 0 evidence: the portal README states it is hosted at slcvet.com.
    productionUrl: 'https://slcvet.com',
    stagingUrl: null,
    environment: 'PRODUCTION',
    integrationType: 'REGISTRY_ONLY',
    adapterType: null,
    integrationStatus: 'NOT_APPLICABLE',
    status: 'PRODUCTION',
    version: null,
    healthCheckEnabled: false,
  },
];

/** Idempotently upsert the known applications by slug. Safe to run repeatedly. */
export async function seedApplications(prisma: PrismaClient): Promise<number> {
  for (const app of KNOWN_APPLICATIONS) {
    const { slug, ...rest } = app;
    await prisma.application.upsert({
      where: { slug },
      update: rest,
      create: app,
    });
  }
  return KNOWN_APPLICATIONS.length;
}
