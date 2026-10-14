import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { config, type FirebaseBridgeApp } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../lib/logger.js';
import { writeAuditLog } from '../audit/auditLog.service.js';
import { getOidcConfiguration } from '../auth/oidc/oidcClient.js';

/**
 * Firebase bridge: lets admins of Firebase-backed SLC apps (Pasumithra,
 * JeevaMitra) sign in with their SLC Account.
 *
 * The app signs the admin in at Keycloak (PKCE, as its own client) and sends
 * the access token here. We verify it (issuer, audience = that app's client,
 * signature, expiry), then mint a Firebase custom token for a dedicated admin
 * identity `slc:<keycloak sub>` carrying `slc_admin` and `slc_roles` claims.
 * The app calls signInWithCustomToken; its Firestore rules check the claims.
 *
 * The apps' service accounts live only here, never in a browser or app bundle.
 */

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function findBridgeApp(clientId: string): FirebaseBridgeApp | undefined {
  return config.firebaseBridge.find((app) => app.clientId === clientId);
}

export function requireBridgeApp(clientId: string): FirebaseBridgeApp {
  const app = findBridgeApp(clientId);
  if (!app) {
    throw new AppError(404, 'BRIDGE_APP_NOT_FOUND', 'This app is not connected to SLC sign-in.');
  }
  return app;
}

/** Firebase uid used for an SLC admin in every bridged project. */
export function firebaseUidFor(subject: string): string {
  return `slc:${subject}`;
}

/** Firebase Admin app for a connected SLC app (also used for server-side management). */
export function firebaseAppForBridge(clientId: string): App {
  return firebaseAppFor(requireBridgeApp(clientId));
}

function firebaseAppFor(bridge: FirebaseBridgeApp): App {
  const name = `bridge:${bridge.clientId}`;
  if (getApps().some((app) => app.name === name)) {
    return getApp(name);
  }
  return initializeApp(
    {
      credential: cert({
        projectId: bridge.serviceAccount.project_id,
        clientEmail: bridge.serviceAccount.client_email,
        privateKey: bridge.serviceAccount.private_key,
      }),
      projectId: bridge.serviceAccount.project_id,
    },
    name,
  );
}

async function verifyIdpToken(token: string, audience: string, opts: { logout?: boolean } = {}): Promise<JWTPayload> {
  const configuration = await getOidcConfiguration();
  const metadata = configuration.serverMetadata();
  if (!metadata.jwks_uri) {
    throw new AppError(502, 'IDENTITY_PROVIDER_ERROR', 'Identity provider has no JWKS.');
  }
  jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: metadata.issuer,
    audience,
    ...(opts.logout ? { requiredClaims: ['iat'], maxTokenAge: '10m' } : {}),
  });
  return payload;
}

export interface BridgeTokenResult {
  customToken: string;
  uid: string;
  roles: string[];
}

export async function exchangeForFirebaseToken(
  clientId: string,
  accessToken: string,
  ctx: { ipAddress?: string; userAgent?: string } = {},
): Promise<BridgeTokenResult> {
  const bridge = requireBridgeApp(clientId);
  // Entries without browser origins are for server-side management only
  // (e.g. JeevaMitra); never mint sign-in tokens for them. CORS alone would
  // not stop a non-browser caller.
  if (bridge.origins.length === 0) {
    throw new AppError(404, 'BRIDGE_APP_NOT_FOUND', 'This app is not connected to SLC sign-in.');
  }

  let claims: JWTPayload;
  try {
    claims = await verifyIdpToken(accessToken, clientId);
  } catch (error) {
    logger.warn({ clientId, err: error instanceof Error ? error.message : String(error) }, 'bridge_token_rejected');
    throw new AppError(401, 'SSO_TOKEN_INVALID', 'Your SLC sign-in could not be verified. Please sign in again.');
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : '';
  const rawRoles = (claims as Record<string, unknown>).roles;
  const roles = Array.isArray(rawRoles) ? rawRoles.filter((r): r is string => typeof r === 'string') : [];
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  if (!subject) {
    throw new AppError(401, 'SSO_TOKEN_INVALID', 'Your SLC sign-in could not be verified.');
  }
  if (roles.length === 0) {
    throw new AppError(403, 'SSO_NO_ACCESS', 'Your SLC Account has no admin role for this app.');
  }

  const uid = firebaseUidFor(subject);
  const customToken = await getAuth(firebaseAppFor(bridge)).createCustomToken(uid, {
    slc_admin: true,
    slc_roles: roles,
    slc_email: email,
  });

  await writeAuditLog({
    action: 'BRIDGE_FIREBASE_SIGN_IN',
    actorEmail: email,
    targetType: 'App',
    targetId: clientId,
    metadata: { oidcSubject: subject, roles, firebaseProject: bridge.serviceAccount.project_id },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { customToken, uid, roles };
}

/**
 * Revoke the person's Firebase refresh tokens in every bridged project. Their
 * current Firebase ID token stays valid until it expires (at most 1 hour).
 */
export async function revokeFirebaseSessions(subject: string): Promise<string[]> {
  const revoked: string[] = [];
  for (const bridge of config.firebaseBridge) {
    try {
      await getAuth(firebaseAppFor(bridge)).revokeRefreshTokens(firebaseUidFor(subject));
      revoked.push(bridge.clientId);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'auth/user-not-found') {
        continue; // never signed in to this app
      }
      logger.error({ clientId: bridge.clientId, err: error instanceof Error ? error.message : String(error) }, 'bridge_revoke_failed');
    }
  }
  return revoked;
}

/** Keycloak back-channel logout for a bridged (public) client. */
export async function handleBridgeBackchannelLogout(clientId: string, logoutToken: string): Promise<void> {
  requireBridgeApp(clientId);
  let payload: JWTPayload;
  try {
    payload = await verifyIdpToken(logoutToken, clientId, { logout: true });
  } catch {
    throw new AppError(400, 'SSO_LOGOUT_INVALID', 'Invalid logout token.');
  }
  const events = payload.events as Record<string, unknown> | undefined;
  const hasEvent = !!events && typeof events === 'object' && typeof events[BACKCHANNEL_LOGOUT_EVENT] === 'object';
  if (!hasEvent || payload.nonce !== undefined || typeof payload.sub !== 'string') {
    // Firebase sessions are per user, so a `sub` is required here.
    throw new AppError(400, 'SSO_LOGOUT_INVALID', 'Invalid logout token.');
  }
  const bridge = requireBridgeApp(clientId);
  try {
    await getAuth(firebaseAppFor(bridge)).revokeRefreshTokens(firebaseUidFor(payload.sub));
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await writeAuditLog({
    action: 'BRIDGE_FIREBASE_SIGNED_OUT',
    targetType: 'App',
    targetId: clientId,
    metadata: { oidcSubject: payload.sub, source: 'backchannel' },
  });
}

/** Test hook. */
export function resetBridgeCache(): void {
  jwks = null;
}
