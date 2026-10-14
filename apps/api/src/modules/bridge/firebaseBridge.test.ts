/**
 * Firebase bridge: SLC (Keycloak) access token in, Firebase custom token out.
 * A local token issuer stands in for Keycloak; the Firebase service account is
 * generated for the test, and custom tokens are really signed with it.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';

import type { Express } from 'express';
import { BaseAuth } from 'firebase-admin/auth';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let idp: http.Server;
let issuer: string;
let signingKey: CryptoKey;
let jwk: JWK;
let app: Express;

const ORIGIN = 'http://localhost:5174';

async function idpToken(claims: Record<string, unknown>, opts: { audience?: string; logout?: boolean } = {}) {
  const jwt = new SignJWT(
    opts.logout ? { events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, ...claims } : claims,
  )
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid! })
    .setIssuer(issuer)
    .setAudience(opts.audience ?? 'pasumithra-admin')
    .setIssuedAt();
  if (!opts.logout) jwt.setExpirationTime('5m');
  return jwt.sign(signingKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  idp = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/realms/slc/.well-known/openid-configuration') {
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
      return;
    }
    if (req.url === '/realms/slc/protocol/openid-connect/certs') {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}/realms/slc`;

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceAccount = {
    type: 'service_account',
    project_id: 'pasumithra-test',
    client_email: 'bridge@pasumithra-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_CLIENT_ID = 'central-admin';
  process.env.OIDC_CLIENT_SECRET = 'secret';
  process.env.PASSWORD_LOGIN_ENABLED = 'true';
  process.env.FIREBASE_SA_PASUMITHRA = Buffer.from(JSON.stringify(serviceAccount)).toString('base64');
  process.env.FIREBASE_BRIDGE_APPS = JSON.stringify([
    { clientId: 'pasumithra-admin', serviceAccountEnv: 'FIREBASE_SA_PASUMITHRA', origins: [ORIGIN] },
  ]);
  const { createApp } = await import('../../app.js');
  app = createApp();
});

afterAll(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  for (const key of ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PASSWORD_LOGIN_ENABLED', 'FIREBASE_SA_PASUMITHRA', 'FIREBASE_BRIDGE_APPS']) {
    delete process.env[key];
  }
});

describe('Firebase bridge', () => {
  it('exchanges a valid SLC token for a Firebase custom token with admin claims', async () => {
    const res = await request(app)
      .post('/api/v1/bridge/firebase/pasumithra-admin/token')
      .set('Origin', ORIGIN)
      .send({ accessToken: await idpToken({ sub: 'kc-ravi', email: 'Ravi@SLC.test', roles: ['moderator'] }) });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.body.data).toMatchObject({ uid: 'slc:kc-ravi', roles: ['moderator'] });
    const custom = decodeJwt(res.body.data.customToken);
    expect(custom).toMatchObject({
      uid: 'slc:kc-ravi',
      iss: 'bridge@pasumithra-test.iam.gserviceaccount.com',
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      claims: { slc_admin: true, slc_roles: ['moderator'], slc_email: 'ravi@slc.test' },
    });
  });

  it('does not allow other browser origins', async () => {
    const res = await request(app)
      .post('/api/v1/bridge/firebase/pasumithra-admin/token')
      .set('Origin', 'https://evil.example')
      .send({ accessToken: await idpToken({ sub: 'kc-ravi', roles: ['moderator'] }) });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects tokens for another app, forged tokens, and users without a role', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'kc-ravi', roles: ['moderator'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience('pasumithra-admin')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const cases: [string, number][] = [
      [await idpToken({ sub: 'kc-ravi', roles: ['moderator'] }, { audience: 'jeevamitra-admin' }), 401],
      [forged, 401],
      [await idpToken({ sub: 'kc-ravi', roles: [] }), 403],
    ];
    for (const [token, status] of cases) {
      const res = await request(app).post('/api/v1/bridge/firebase/pasumithra-admin/token').send({ accessToken: token });
      expect(res.status).toBe(status);
    }
  });

  it('returns 404 for apps that are not bridged', async () => {
    const res = await request(app)
      .post('/api/v1/bridge/firebase/unknown-admin/token')
      .send({ accessToken: await idpToken({ sub: 'x', roles: ['admin'] }, { audience: 'unknown-admin' }) });
    expect(res.status).toBe(404);
  });

  it('revokes Firebase sessions on a valid back-channel logout only', async () => {
    const revoke = vi.spyOn(BaseAuth.prototype, 'revokeRefreshTokens').mockResolvedValue(undefined);

    const bad = await request(app)
      .post('/api/v1/bridge/firebase/pasumithra-admin/backchannel-logout')
      .type('form')
      .send({ logout_token: await idpToken({ sub: 'kc-ravi' }, { logout: true, audience: 'other-app' }) });
    expect(bad.status).toBe(400);
    expect(revoke).not.toHaveBeenCalled();

    const ok = await request(app)
      .post('/api/v1/bridge/firebase/pasumithra-admin/backchannel-logout')
      .type('form')
      .send({ logout_token: await idpToken({ sub: 'kc-ravi', sid: 's1' }, { logout: true }) });
    expect(ok.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith('slc:kc-ravi');
    revoke.mockRestore();
  });
});
