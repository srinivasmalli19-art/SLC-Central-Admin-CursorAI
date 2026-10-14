/**
 * Enrol (or re-enrol) a break-glass admin's authenticator app.
 *
 * Break-glass accounts are the local email + password accounts allowed to sign
 * in when central SSO (Keycloak) is unavailable. In production they must also
 * enter a 6-digit code from an authenticator app. Enrolment deliberately needs
 * shell access to the server; there is no web page for it.
 *
 * Usage (server shell, with the production environment loaded):
 *   npm run -w @slc/api mfa:enroll -- ops@slcvet.com
 *   npm run -w @slc/api mfa:enroll -- ops@slcvet.com --reset   # replace a lost device
 *
 * The person scans/types the secret into their authenticator app, then types
 * the current code to confirm. Nothing is saved until the code checks out.
 */
import { createInterface } from 'node:readline';

import { config } from '../src/config/env.js';
import { requirePrisma } from '../src/db/prisma.js';
import { parseKey, seal } from '../src/lib/secretBox.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../src/lib/totp.js';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';
import { recordAuthEvent } from '../src/modules/auth/authEvents.js';

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const emailArg = args.find((a) => !a.startsWith('--')) ?? (await ask('Break-glass account email: '));
  const email = normalizeEmail(emailArg);

  if (!config.breakGlass.mfaKey) {
    fail('MFA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32');
  }
  const key = parseKey(config.breakGlass.mfaKey);

  if (config.breakGlass.allowedEmails.length > 0 && !config.breakGlass.allowedEmails.includes(email)) {
    fail(`${email} is not in PASSWORD_LOGIN_ALLOWED_EMAILS, so it could not use password sign-in anyway.`);
  }

  const prisma = requirePrisma();
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) fail(`No Central Admin account with email ${email}. Create it first (npm run bootstrap:admin).`);
  if (!admin.passwordHash) fail(`${email} is an SSO-only account; its MFA is managed in Keycloak.`);
  if (admin.mfaEnabled && !reset) fail(`${email} already has an authenticator. Use --reset to replace it.`);

  const secret = generateTotpSecret();
  console.log(`\nAdd this account to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, ...).`);
  console.log(`\n  Account: ${email}`);
  console.log(`  Secret key (type it in, "time-based"): ${secret.replace(/(.{4})/g, '$1 ').trim()}`);
  console.log(`\n  Or open/convert this link to a QR code:\n  ${otpauthUri(secret, email)}\n`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const code = (await ask('Enter the 6-digit code the app shows now: ')).replace(/\s/g, '');
    const step = verifyTotp(secret, code);
    if (step !== null) {
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { mfaEnabled: true, mfaSecret: seal(secret, key), mfaLastUsedStep: step },
      });
      recordAuthEvent('ADMIN_MFA_ENROLLED', { adminUserId: admin.id, email, metadata: { reset } });
      console.log(`\n✓ Authenticator enrolled for ${email}. Password sign-in now also asks for a code.\n`);
      await prisma.$disconnect();
      return;
    }
    console.log('  That code did not match. Check the phone clock is automatic and try the next code.');
  }
  fail('Too many wrong codes; nothing was saved.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
