/**
 * End-to-end test of Central Admin sign-in through a real OpenID Connect
 * provider (`oidc-provider`, a certified OP standing in for Keycloak):
 * discovery, Authorization Code + PKCE, state/nonce, ID-token validation, role
 * mapping, session cookie, single logout and back-channel logout.
 *
 * Only the database is replaced (in-memory fake), so this suite runs without
 * PostgreSQL.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import Provider from 'oidc-provider';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@slc/shared';

import { createFakePrisma } from '../../../../test/fakePrisma.js';

const fake = vi.hoisted(() => ({ prisma: undefined as unknown }));

vi.mock('../../../db/prisma.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../db/prisma.js')>();
  return { ...original, requirePrisma: () => fake.prisma };
});

const CLIENT_ID = 'central-admin';
const CLIENT_SECRET = 'test-client-secret';
const REDIRECT_URI = 'http://localhost:5173/api/v1/auth/oidc/callback';
const SESSION_COOKIE = 'slc_admin_session';

interface TestAccount {
  email: string;
  email_verified: boolean;
  name: string;
  roles: string[];
  resource_access?: Record<string, { roles: string[] }>;
}
const accounts: Record<string, TestAccount> = {
  'kc-super': {
    email: 'super@slc.test',
    email_verified: true,
    name: 'Super Admin',
    roles: ['SUPER_ADMIN'],
    resource_access: {
      'central-admin': { roles: ['SUPER_ADMIN'] },
      'jeevamitra-admin': { roles: ['admin'] },
      'nearsip-admin': { roles: ['viewer'] },
    },
  },
  'kc-support': {
    email: 'support@slc.test',
    email_verified: true,
    name: 'Support Person',
    roles: ['SUPPORT_ADMIN', 'some-other-app-role'],
  },
  'kc-none': { email: 'nobody@slc.test', email_verified: true, name: 'No Access', roles: [] },
};
let nextAccount = 'kc-super';

let idp: http.Server;
let issuer: string;
let signingKey: CryptoKey;
let signingJwk: JWK;
let app: Express;
let state: ReturnType<typeof createFakePrisma>['state'];

/** Tiny cookie jar for driving the IdP with fetch. */
function collectCookies(jar: Map<string, string>, res: Response): void {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [name, ...rest] = pair!.split('=');
    jar.set(name!.trim(), rest.join('='));
  }
}
function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
function cookieFrom(setCookie: string[] | string | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = list.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(';')[0]!.slice(name.length + 1) : undefined;
}

/** Follow IdP redirects (with cookies) until it redirects back to our redirect_uri. */
async function authorizeAtIdp(authorizationUrl: string): Promise<URL> {
  const jar = new Map<string, string>();
  let url = authorizationUrl;
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader(jar) } });
    collectCookies(jar, res);
    const location = res.headers.get('location');
    if (!location) {
      throw new Error(`IdP stopped at ${url} with ${res.status}: ${await res.text()}`);
    }
    const next = new URL(location, url);
    if (next.href.startsWith(REDIRECT_URI)) {
      return next;
    }
    url = next.href;
  }
  throw new Error('too many IdP redirects');
}

/** Run a full sign-in and return the Central Admin session cookie (or the error redirect). */
async function signIn(account: string, returnTo?: string) {
  nextAccount = account;
  const start = await request(app).get(
    `/api/v1/auth/oidc/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
  );
  expect(start.status).toBe(302);
  const txn = cookieFrom(start.headers['set-cookie'], 'slc_oidc_txn');
  expect(txn).toBeTruthy();

  const callback = await authorizeAtIdp(start.headers.location as string);
  const done = await request(app)
    .get(`${callback.pathname}${callback.search}`)
    .set('Cookie', `slc_oidc_txn=${txn}`);
  expect(done.status).toBe(302);
  return {
    location: done.headers.location as string,
    session: cookieFrom(done.headers['set-cookie'], SESSION_COOKIE),
    authorizeUrl: new URL(start.headers.location as string),
  };
}

async function logoutToken(claims: Record<string, unknown>, opts: { audience?: string } = {}) {
  return new SignJWT({ events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: signingJwk.kid! })
    .setIssuer(issuer)
    .setAudience(opts.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(signingKey);
}

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  signingKey = privateKey as CryptoKey;
  signingJwk = { ...(await exportJWK(privateKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  // Start the IdP on a free port first so its issuer URL is known.
  idp = http.createServer();
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;

  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uris: [REDIRECT_URI],
        post_logout_redirect_uris: ['http://localhost:5173/login'],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        backchannel_logout_uri: 'http://localhost:5173/api/v1/auth/oidc/backchannel-logout',
        backchannel_logout_session_required: true,
      },
    ],
    jwks: { keys: [signingJwk] },
    cookies: { keys: ['test-cookie-key'] },
    claims: { openid: ['sub', 'roles', 'resource_access'], email: ['email', 'email_verified'], profile: ['name'] },
    conformIdTokenClaims: false,
    ttl: { Interaction: 600, Grant: 600, Session: 3600, AccessToken: 300, IdToken: 300 },
    features: {
      devInteractions: { enabled: false },
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: { enabled: true },
    },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (_ctx, sub) => ({
      accountId: sub,
      claims: async () => ({ sub, ...accounts[sub] }),
    }),
  });

  const providerHandler = provider.callback();
  idp.on('request', (req, res) => {
    if (!req.url?.startsWith('/interaction/')) {
      providerHandler(req, res);
      return;
    }
    // Stand-in for the Keycloak login + MFA screens: sign in `nextAccount`.
    void (async () => {
      const details = await provider.interactionDetails(req, res);
      const grant = new provider.Grant({ accountId: nextAccount, clientId: CLIENT_ID });
      grant.addOIDCScope(String(details.params.scope));
      const grantId = await grant.save();
      await provider.interactionFinished(
        req,
        res,
        { login: { accountId: nextAccount }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      );
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });

  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
  process.env.PASSWORD_LOGIN_ENABLED = 'false';
  const { createApp } = await import('../../../app.js');
  app = createApp();
});

beforeEach(() => {
  const created = createFakePrisma(ROLE_KEYS, ROLE_PERMISSIONS);
  fake.prisma = created.prisma;
  state = created.state;
});

afterAll(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  for (const key of ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PASSWORD_LOGIN_ENABLED']) {
    delete process.env[key];
  }
});

describe('Central SSO sign-in (OIDC)', () => {
  it('advertises SSO-only sign-in and refuses the password form', async () => {
    const options = await request(app).get('/api/v1/auth/config');
    expect(options.body.data).toEqual({
      passwordLoginEnabled: false,
      ssoEnabled: true,
      ssoProviderName: 'SLC Account',
    });
    const password = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'super@slc.test', password: 'whatever-long-enough' });
    expect(password.status).toBe(403);
    expect(password.body.error.code).toBe('PASSWORD_LOGIN_DISABLED');
  });

  it('starts the authorization code flow with PKCE S256, state and nonce', async () => {
    const res = await request(app).get('/api/v1/auth/oidc/login');
    const url = new URL(res.headers.location as string);
    expect(url.origin).toBe(issuer);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();

    const txnCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('slc_oidc_txn='))!;
    expect(txnCookie).toMatch(/HttpOnly/);
    expect(txnCookie).toMatch(/SameSite=Lax/);
    expect(txnCookie).toMatch(/Path=\/api\/v1\/auth\/oidc/);
  });

  it('signs a Super Admin in, provisions the account and maps roles from the token', async () => {
    const result = await signIn('kc-super', '/applications');
    expect(result.location).toBe('http://localhost:5173/applications');
    expect(result.session).toBeTruthy();

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${result.session}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user).toMatchObject({ email: 'super@slc.test', name: 'Super Admin', roles: ['SUPER_ADMIN'] });
    expect(me.body.data.user.permissions).toContain('admin_users.manage');
    expect(me.body.data.user.appRoles).toEqual({
      'central-admin': ['SUPER_ADMIN'],
      'jeevamitra-admin': ['admin'],
      'nearsip-admin': ['viewer'],
    });

    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({ oidcSubject: 'kc-super', passwordHash: null });
    expect(state.sessions[0]!.oidcSid).toBeTruthy();
  });

  it('ignores roles meant for other apps', async () => {
    const result = await signIn('kc-support');
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${result.session}`);
    expect(me.body.data.user.roles).toEqual(['SUPPORT_ADMIN']);
  });

  it('rejects an IdP user with no Central Admin role', async () => {
    const result = await signIn('kc-none');
    expect(result.location).toBe('http://localhost:5173/login?error=sso_no_access');
    expect(result.session).toBeUndefined();
    expect(state.users).toHaveLength(0);
  });

  it('links an existing local admin by verified email instead of duplicating it', async () => {
    state.users.push({
      id: 'local-1',
      email: 'super@slc.test',
      passwordHash: 'argon-hash',
      oidcSubject: null,
      name: 'Old Name',
      status: 'ACTIVE',
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await signIn('kc-super');
    expect(result.session).toBeTruthy();
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({ id: 'local-1', oidcSubject: 'kc-super', name: 'Super Admin' });
  });

  it('keeps honouring a local DISABLED status', async () => {
    await signIn('kc-super');
    state.users[0]!.status = 'DISABLED';
    const again = await signIn('kc-super');
    expect(again.location).toBe('http://localhost:5173/login?error=sso_account_disabled');
  });

  it('rejects a callback whose state does not match the transaction', async () => {
    nextAccount = 'kc-super';
    const start = await request(app).get('/api/v1/auth/oidc/login');
    const otherStart = await request(app).get('/api/v1/auth/oidc/login');
    const callback = await authorizeAtIdp(start.headers.location as string);
    // Replay the callback with a different login attempt's transaction cookie.
    const wrongTxn = cookieFrom(otherStart.headers['set-cookie'], 'slc_oidc_txn');
    const done = await request(app)
      .get(`${callback.pathname}${callback.search}`)
      .set('Cookie', `slc_oidc_txn=${wrongTxn}`);
    expect(done.headers.location).toBe('http://localhost:5173/login?error=sso_failed');
    expect(cookieFrom(done.headers['set-cookie'], SESSION_COOKIE)).toBeUndefined();
  });

  it('rejects a callback without a transaction cookie', async () => {
    const done = await request(app).get('/api/v1/auth/oidc/callback?code=abc&state=xyz');
    expect(done.headers.location).toBe('http://localhost:5173/login?error=sso_failed');
  });

  it('logs out locally and returns the IdP end-session URL (single logout)', async () => {
    const { session } = await signIn('kc-super');
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(me.status).toBe(200);

    const csrf = 'csrf-test-token';
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${SESSION_COOKIE}=${session}; slc_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);
    const logoutUrl = new URL(out.body.data.ssoLogoutUrl);
    expect(logoutUrl.origin).toBe(issuer);
    expect(logoutUrl.searchParams.get('id_token_hint')).toBeTruthy();
    expect(logoutUrl.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/login');

    const after = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(after.status).toBe(401);
  });

  it('ends the session when the IdP sends a valid back-channel logout token', async () => {
    const { session } = await signIn('kc-super');
    const sid = state.sessions[0]!.oidcSid!;

    const res = await request(app)
      .post('/api/v1/auth/oidc/backchannel-logout')
      .type('form')
      .send({ logout_token: await logoutToken({ sub: 'kc-super', sid }) });
    expect(res.status).toBe(200);

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(me.status).toBe(401);
  });

  it('rejects forged or malformed back-channel logout tokens', async () => {
    const { session } = await signIn('kc-super');
    const sid = state.sessions[0]!.oidcSid!;

    const wrongAudience = await logoutToken({ sub: 'kc-super', sid }, { audience: 'pasumithra-admin' });
    const withNonce = await logoutToken({ sub: 'kc-super', sid, nonce: 'x' });
    const { privateKey: otherKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
      sub: 'kc-super',
      sid,
    })
      .setProtectedHeader({ alg: 'RS256', kid: signingJwk.kid! })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .sign(otherKey);

    for (const token of [wrongAudience, withNonce, forged, 'not-a-jwt']) {
      const res = await request(app)
        .post('/api/v1/auth/oidc/backchannel-logout')
        .type('form')
        .send({ logout_token: token });
      expect(res.status).toBe(400);
    }

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(me.status).toBe(200);
  });
});
