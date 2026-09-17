/**
 * Bootstrap the initial SUPER_ADMIN administrator.
 *
 * SAFETY:
 * - There is NO default password anywhere. Credentials must be supplied via
 *   `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` or entered
 *   interactively.
 * - Refuses to run in production unless `--allow-production` is passed
 *   explicitly (production bootstrap is documented separately).
 * - Refuses to run if a SUPER_ADMIN already exists.
 * - Requires roles/permissions to be seeded first (`npm run db:seed`).
 *
 * Usage:
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD=... \
 *     npm run bootstrap:admin
 *   # or run interactively (you will be prompted)
 */
import { createInterface } from 'node:readline';

import { config } from '../src/config/env.js';
import { requirePrisma } from '../src/db/prisma.js';
import { hashPassword, validatePasswordPolicy } from '../src/lib/password.js';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function prompt(question: string, { hidden = false } = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) {
    // Mute echoed characters for password entry.
    const output = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput: (s: string) => void };
    output._writeToOutput = (stringToWrite: string) => {
      if (stringToWrite.includes(question)) {
        output.output.write(stringToWrite);
      } else {
        output.output.write('*');
      }
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const allowProduction = process.argv.includes('--allow-production');

  if ((config.isProduction || config.isStaging) && !allowProduction) {
    fail(
      'Refusing to bootstrap in production/staging without --allow-production. ' +
        'See docs/SLC-PHASE-2-AUTH-RBAC.md for the production procedure.',
    );
  }

  const prisma = requirePrisma();

  const superRole = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  if (!superRole) {
    fail('SUPER_ADMIN role not found. Run `npm run db:seed` first to seed roles/permissions.');
  }

  const existingSuperAdmins = await prisma.adminUser.count({
    where: { roles: { some: { role: { key: 'SUPER_ADMIN' } } } },
  });
  if (existingSuperAdmins > 0) {
    fail('A SUPER_ADMIN already exists. Refusing to create another via bootstrap.');
  }

  const emailInput = config.bootstrap.email ?? (await prompt('Admin email: '));
  const password = config.bootstrap.password ?? (await prompt('Admin password: ', { hidden: true }));

  const email = normalizeEmail(emailInput);
  if (!email || !email.includes('@')) {
    fail('A valid email address is required.');
  }

  const problems = validatePasswordPolicy(password, email);
  if (problems.length > 0) {
    fail(`Password does not meet the policy:\n  - ${problems.join('\n  - ')}`);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    fail('An administrator with this email already exists.');
  }

  const passwordHash = await hashPassword(password);
  const created = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name: 'Super Admin',
      roles: { create: [{ roleId: superRole!.id }] },
    },
  });

  console.log(`\n✓ Created SUPER_ADMIN: ${created.email}\n`);
}

main()
  .catch((error) => {
    console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void requirePrisma().$disconnect();
  });
