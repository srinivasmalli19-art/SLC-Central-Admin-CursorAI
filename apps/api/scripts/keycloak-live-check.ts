/**
 * Live check: runs Central Admin's real identity, sign-in and Firebase-bridge
 * code against a RUNNING Keycloak with the `slc` realm imported. Nothing here is
 * mocked; no database is needed.
 *
 *   KEYCLOAK_URL=http://localhost:8080 npm run -w @slc/api keycloak:live-check
 *
 * It creates one throw-away admin (`live-check-<time>@slc.local`), exercises it,
 * and deletes it again. Use a development or staging realm, never production.
 * Exit code 0 = every check passed.
 */
import { generateKeyPairSync } from 'node:crypto';

const KEYCLOAK_URL = (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const REALM = process.env.KEYCLOAK_REALM ?? 'slc';
const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;

// Settings must be in place before the app's config module is first imported.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fakeServiceAccount = {
  project_id: 'live-check-pasumithra',
  client_email: 'bridge@live-check-pasumithra.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
Object.assign(process.env, {
  NODE_ENV: 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
  OIDC_ISSUER_URL: ISSUER,
  OIDC_CLIENT_ID: 'central-admin',
  OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? 'dev-only-central-admin-secret-change-me',
  KEYCLOAK_ADMIN_CLIENT_ID: 'central-admin-api',
  KEYCLOAK_ADMIN_CLIENT_SECRET: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? 'dev-only-central-admin-api-secret-change-me',
  KEYCLOAK_SEND_INVITE_EMAIL: 'false',
  FIREBASE_SA_LIVECHECK: JSON.stringify(fakeServiceAccount),
  FIREBASE_BRIDGE_APPS: JSON.stringify([
    { clientId: 'pasumithra-admin', serviceAccountEnv: 'FIREBASE_SA_LIVECHECK', origins: ['http://localhost:3001'] },
  ]),
});
delete process.env.DATABASE_URL;

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? undefined });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function expectError(fn: () => Promise<unknown>, code: string): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert(actual === code, `expected ${code}, got ${actual ?? String(error)}`);
    return `refused with ${code}`;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
/** A token must be usable by exactly one app: aud == [clientId] and azp == clientId. */
function assertOnlyFor(token: string, clientId: string): void {
  const claims = decodeJwt(token);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  assert(
    aud.length === 1 && aud[0] === clientId && claims.azp === clientId,
    `token for ${clientId} has aud=${JSON.stringify(claims.aud)} azp=${String(claims.azp)} (other apps would accept it)`,
  );
}
function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Drive Keycloak's real login form (username + password) and return the redirect URL with the code. */
async function loginThroughKeycloakForm(authorizationUrl: string, username: string, password: string): Promise<URL> {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const eq = pair!.indexOf('=');
      jar.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  const page = await fetch(authorizationUrl, { redirect: 'manual', headers: { cookie: cookie() } });
  keep(page);
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  assert(action, `Keycloak login form not found (HTTP ${page.status})`);

  const submit = await fetch(action.replace(/&amp;/g, '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  keep(submit);
  const location = submit.headers.get('location');
  assert(location, `login did not redirect (HTTP ${submit.status}); a required action may still be pending`);
  return new URL(location);
}

/** Sign in as a public SPA client (Authorization Code + PKCE) and return its access token. */
async function publicClientLogin(
  oidc: typeof import('openid-client'),
  clientId: string,
  redirectUri: string,
  username: string,
  password: string,
): Promise<string> {
  const discovered = await oidc.discovery(new URL(ISSUER), clientId, undefined, oidc.None(), {
    execute: [oidc.allowInsecureRequests],
  });
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const url = oidc.buildAuthorizationUrl(discovered, {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  });
  const callback = await loginThroughKeycloakForm(url.href, username, password);
  const tokens = await oidc.authorizationCodeGrant(discovered, callback, { pkceCodeVerifier: verifier, expectedState: state });
  return tokens.access_token;
}

async function main(): Promise<void> {
  const oidc = await import('openid-client');
  const { kcRequest } = await import('../src/modules/identity/keycloakAdmin.client.js');
  const identity = await import('../src/modules/identity/identity.service.js');
  const { extractRoleKeys, extractAppRoles } = await import('../src/modules/auth/oidc/claims.js');
  const { exchangeCode, buildAuthorizationRequest } = await import('../src/modules/auth/oidc/oidcClient.js');
  const { exchangeForFirebaseToken } = await import('../src/modules/bridge/firebaseBridge.service.js');
  const { PERMISSIONS } = await import('@slc/shared');

  const superActor = {
    admin: {
      id: 'live-check-actor',
      email: 'live-check-actor@slc.local',
      name: 'Live check',
      status: 'ACTIVE' as const,
      mfaEnabled: true,
      roles: ['SUPER_ADMIN' as const],
      permissions: [...PERMISSIONS],
      appRoles: {},
    },
  };
  const supportActor = {
    admin: { ...superActor.admin, roles: ['SUPPORT_ADMIN' as const], permissions: ['admin_users.view', 'admin_users.manage'] as typeof PERMISSIONS[number][] },
  };

  const email = `live-check-${Date.now()}@slc.local`;
  const password = `Live-Check-${Date.now()}-Pw!`;
  let userId = '';

  await check('Realm discovery: issuer, PKCE S256, back-channel logout, end-session', async () => {
    const res = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    const meta = (await res.json()) as Record<string, unknown>;
    assert(meta.issuer === ISSUER, `issuer is ${String(meta.issuer)}`);
    assert((meta.code_challenge_methods_supported as string[]).includes('S256'), 'S256 not supported');
    assert(meta.backchannel_logout_supported === true, 'back-channel logout not supported');
    assert(typeof meta.end_session_endpoint === 'string', 'no end_session_endpoint');
  });

  await check('Service account lists the SLC apps and their roles (Admin API)', async () => {
    const apps = await identity.listManagedApps();
    const ids = apps.map((a) => a.clientId);
    for (const id of ['central-admin', 'pasumithra-admin', 'jeevamitra-admin', 'stock-admin', 'nearsip-admin']) {
      assert(ids.includes(id), `missing app ${id}`);
    }
    const central = apps.find((a) => a.clientId === 'central-admin')!;
    assert(central.roles.includes('SUPER_ADMIN'), 'central-admin has no SUPER_ADMIN role');
    return `${apps.length} apps`;
  });

  await check('Service account cannot change realm security settings (least privilege)', async () => {
    const tokenRes = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'central-admin-api',
        client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
      }),
    });
    const token = ((await tokenRes.json()) as { access_token: string }).access_token;
    const attempts = [
      { what: 'realm settings', method: 'PUT', path: '', body: { bruteForceProtected: false } },
      { what: 'client list edit', method: 'POST', path: '/clients', body: { clientId: 'live-check-rogue' } },
      { what: 'realm roles', method: 'POST', path: '/roles', body: { name: 'live-check-rogue' } },
    ];
    for (const a of attempts) {
      const res = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${a.path}`, {
        method: a.method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(a.body),
      });
      assert(res.status === 403, `${a.what}: expected 403, got ${res.status}`);
    }
    return 'realm settings, clients and realm roles all 403';
  });

  await check('Lists existing admins (seed super admin present)', async () => {
    const users = await identity.listUsers({ search: 'slc.local' });
    assert(users.some((u) => u.email === 'superadmin@slc.local'), 'superadmin@slc.local not listed');
    return `${users.length} users`;
  });

  await check('A non-Super-Admin cannot invite a Super Admin', () =>
    expectError(
      () => identity.inviteUser({ email, appRoles: { 'central-admin': ['SUPER_ADMIN'] } }, supportActor),
      'FORBIDDEN',
    ),
  );

  await check('Invite an admin with roles in two apps; MFA set-up is required', async () => {
    const { user } = await identity.inviteUser(
      { email, firstName: 'Live', lastName: 'Check', appRoles: { 'central-admin': ['SUPPORT_ADMIN'], 'pasumithra-admin': ['moderator'] } },
      superActor,
    );
    userId = user.id;
    const raw = (await kcRequest<{ requiredActions?: string[] }>('GET', `/users/${userId}`)).data;
    assert(raw?.requiredActions?.includes('CONFIGURE_TOTP'), 'CONFIGURE_TOTP is not required');
    assert(raw?.requiredActions?.includes('UPDATE_PASSWORD'), 'UPDATE_PASSWORD is not required');
    return `user ${userId.slice(0, 8)}…`;
  });

  await check('Add a role in a third app (Stock Management viewer)', async () => {
    const user = await identity.setUserAppRoles(userId, { 'stock-admin': ['viewer'] }, superActor);
    const roles = (user as unknown as { appRoles: Record<string, string[]> }).appRoles;
    assert(roles['stock-admin']?.includes('viewer'), `stock-admin roles: ${JSON.stringify(roles['stock-admin'])}`);
    assert(roles['pasumithra-admin']?.includes('moderator'), 'pasumithra role was lost');
  });

  // Harness only: stands in for the person finishing set-up (own password; no
  // authenticator app, so this login is password-only).
  await kcRequest('PUT', `/users/${userId}/reset-password`, { type: 'password', value: password, temporary: false });
  await kcRequest('PUT', `/users/${userId}`, { requiredActions: [], emailVerified: true });

  let centralSid = '';
  await check('Central Admin sign-in through the real Keycloak login form (code + PKCE)', async () => {
    const request = await buildAuthorizationRequest();
    const callback = await loginThroughKeycloakForm(request.url.href, email, password);
    const { claims, idToken } = await exchangeCode(callback, request);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    assert(aud.includes('central-admin'), `aud is ${JSON.stringify(claims.aud)}`);
    assert(JSON.stringify(extractRoleKeys(claims, 'roles')) === '["SUPPORT_ADMIN"]', `roles: ${JSON.stringify(claims.roles)}`);
    const appRoles = extractAppRoles(claims);
    assert(appRoles['pasumithra-admin']?.includes('moderator'), `resource_access: ${JSON.stringify(claims.resource_access)}`);
    assert(appRoles['stock-admin']?.includes('viewer'), 'stock-admin role missing from token');
    assert(typeof claims.sid === 'string', 'no sid claim (needed for back-channel logout)');
    assert(claims.email === email, `email claim ${String(claims.email)}`);
    centralSid = claims.sid as string;
    const idClaims = decodeJwt(idToken);
    return `roles SUPPORT_ADMIN; ID token lifetime ${Number(idClaims.exp) - Number(idClaims.iat)}s`;
  });

  let pasumithraToken = '';
  await check('Pasumithra admin sign-in (public client + PKCE) gets only Pasumithra roles', async () => {
    pasumithraToken = await publicClientLogin(oidc, 'pasumithra-admin', 'http://localhost:3001/auth/callback', email, password);
    const access = decodeJwt(pasumithraToken);
    assertOnlyFor(pasumithraToken, 'pasumithra-admin');
    assert(JSON.stringify(access.roles) === '["moderator"]', `roles claim is ${JSON.stringify(access.roles)}`);
    return `access token lifetime ${Number(access.exp) - Number(access.iat)}s`;
  });

  await check('Firebase bridge turns the Pasumithra token into a Firebase custom token', async () => {
    const result = await exchangeForFirebaseToken('pasumithra-admin', pasumithraToken);
    const claims = decodeJwt(result.customToken) as { uid: string; claims: Record<string, unknown> };
    assert(claims.uid === `slc:${userId}`, `uid ${claims.uid}`);
    assert(claims.claims.slc_admin === true, 'slc_admin claim missing');
    assert(JSON.stringify(claims.claims.slc_roles) === '["moderator"]', `slc_roles ${JSON.stringify(claims.claims.slc_roles)}`);
    return `uid ${claims.uid.slice(0, 13)}…, roles moderator`;
  });

  await check('Firebase bridge refuses a token issued to a different app', async () => {
    const tokenRes = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'central-admin-api',
        client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET!,
      }),
    });
    const other = ((await tokenRes.json()) as { access_token: string }).access_token;
    return expectError(() => exchangeForFirebaseToken('pasumithra-admin', other), 'SSO_TOKEN_INVALID');
  });

  await check('Stock Management sign-in: token for stock-admin, verified by the Stock app', async () => {
    await identity.setUserAppRoles(userId, { 'stock-admin': ['manager'] }, superActor);
    const token = await publicClientLogin(oidc, 'stock-admin', 'http://localhost:3000/sso/callback', email, password);
    const access = decodeJwt(token);
    assertOnlyFor(token, 'stock-admin');
    assert(JSON.stringify(access.roles) === '["manager"]', `roles claim is ${JSON.stringify(access.roles)}`);
    let bridgeRefused = false;
    try {
      await exchangeForFirebaseToken('pasumithra-admin', token);
    } catch {
      bridgeRefused = true;
    }
    assert(bridgeRefused, 'Firebase bridge accepted a Stock Management token for Pasumithra');
    const verifierPath = process.env.STOCK_SSO_VERIFIER;
    if (!verifierPath) {
      return 'token OK (set STOCK_SSO_VERIFIER to also run the Stock app\'s own verifier)';
    }
    const { createRequire } = await import('node:module');
    const stock = createRequire(import.meta.url)(verifierPath) as {
      createSsoVerifier: (o: { issuerUrl: string; clientId: string }) => { verifyAccessToken: (t: string) => Promise<Record<string, unknown>> };
      allowedLocalRoles: (roles: unknown) => Set<string>;
    };
    const verifier = stock.createSsoVerifier({ issuerUrl: ISSUER, clientId: 'stock-admin' });
    const payload = await verifier.verifyAccessToken(token);
    const allowed = [...stock.allowedLocalRoles(payload.roles)];
    assert(JSON.stringify(allowed) === '["Admin"]', `allowed local roles ${JSON.stringify(allowed)}`);
    let rejected = false;
    try {
      await verifier.verifyAccessToken(pasumithraToken);
    } catch {
      rejected = true;
    }
    assert(rejected, 'Stock verifier accepted a Pasumithra token');
    return "Stock app's verifier: may open Admin accounts; rejects Pasumithra token";
  });

  await check('Keycloak tracks the sign-in sessions', async () => {
    const sessions = (await kcRequest<unknown[]>('GET', `/users/${userId}/sessions`)).data ?? [];
    assert(sessions.length >= 1, 'no active sessions');
    assert(centralSid.length > 0, 'no sid recorded');
    return `${sessions.length} session(s)`;
  });

  await check('The last Super Admin cannot be disabled', async () => {
    const seed = (await identity.listUsers({ search: 'superadmin@slc.local' })).find((u) => u.email === 'superadmin@slc.local');
    assert(seed, 'seed super admin not found');
    return expectError(() => identity.setUserEnabled(seed.id, false, superActor), 'LAST_SUPER_ADMIN');
  });

  await check('Disabling an admin signs them out everywhere and blocks sign-in', async () => {
    await identity.setUserEnabled(userId, false, superActor);
    const sessions = (await kcRequest<unknown[]>('GET', `/users/${userId}/sessions`)).data ?? [];
    assert(sessions.length === 0, `${sessions.length} session(s) still open`);
    const request = await buildAuthorizationRequest();
    try {
      await loginThroughKeycloakForm(request.url.href, email, password);
    } catch {
      return 'sessions 0, sign-in refused';
    }
    throw new Error('a disabled admin could still sign in');
  });

  if (userId) {
    await kcRequest('DELETE', `/users/${userId}`).catch(() => undefined);
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail ?? ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed against ${ISSUER}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
