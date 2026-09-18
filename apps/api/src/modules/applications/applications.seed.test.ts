import { beforeAll, describe, expect, it } from 'vitest';

import { requirePrisma } from '../../db/prisma.js';
import { KNOWN_APPLICATIONS, seedApplications } from '../../../../../prisma/seedApplications.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d('application registry seed', () => {
  beforeAll(async () => {
    const prisma = requirePrisma();
    await prisma.application.deleteMany({});
  });

  it('defines exactly 6 known applications', () => {
    expect(KNOWN_APPLICATIONS).toHaveLength(6);
  });

  it('is idempotent (running twice does not duplicate)', async () => {
    const prisma = requirePrisma();
    await seedApplications(prisma);
    await seedApplications(prisma);

    const total = await prisma.application.count();
    expect(total).toBe(6);

    const slugs = (await prisma.application.findMany({ select: { slug: true } })).map((a) => a.slug);
    expect(new Set(slugs).size).toBe(6);
  });

  it('seeds SLC Apps Portal as PRODUCTION with the documented URL only', async () => {
    const prisma = requirePrisma();
    const portal = await prisma.application.findUnique({ where: { slug: 'slc-apps-portal' } });
    expect(portal?.status).toBe('PRODUCTION');
    expect(portal?.productionUrl).toBe('https://slcvet.com');
  });

  it('keeps other applications UNKNOWN with no fabricated production URLs', async () => {
    const prisma = requirePrisma();
    const slcVet = await prisma.application.findUnique({ where: { slug: 'slc-vet' } });
    expect(slcVet?.status).toBe('UNKNOWN');
    expect(slcVet?.productionUrl).toBeNull();
    expect(slcVet?.integrationStatus).toBe('PLANNED');

    const gps = await prisma.application.findUnique({ where: { slug: 'slc-gps-camera' } });
    expect(gps?.integrationType).toBe('REGISTRY_ONLY');
    expect(gps?.integrationStatus).toBe('NOT_APPLICABLE');
  });

  it('does not seed unresolved applications', async () => {
    const prisma = requirePrisma();
    const unresolved = await prisma.application.count({
      where: { slug: { in: ['nearsip', 'jeevamitra-app', 'stock-management-android'] } },
    });
    expect(unresolved).toBe(0);
  });
});
