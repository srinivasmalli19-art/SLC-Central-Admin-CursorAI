import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import * as oidc from 'openid-client';

import { config, type OidcConfig } from '../../../config/env.js';
import { AppError } from '../../../errors/AppError.js';

/**
 * Thin wrapper around `openid-client` for the central identity provider
 * (Keycloak). Discovery metadata is fetched once and cached; a failed discovery
 * is not cached so the next request retries.
 */

let configurationPromise: Promise<oidc.Configuration> | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function requireOidcSettings(): OidcConfig {
  if (!config.oidc) {
    throw new AppError(404, 'SSO_DISABLED', 'Central sign-in is not configured.');
  }
  return config.oidc;
}

export function getOidcConfiguration(): Promise<oidc.Configuration> {
  const settings = requireOidcSettings();
  if (!configurationPromise) {
    const issuer = new URL(settings.issuerUrl);
    configurationPromise = oidc
      .discovery(
        issuer,
        settings.clientId,
        settings.clientSecret,
        undefined,
        {
          // Also applies to later token requests; long enough for a provider
          // that scales to zero to wake up.
          timeout: settings.timeoutSeconds,
          // Plain http is only ever permitted outside production/staging (validated in env.ts).
          ...(issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : {}),
        },
      )
      .catch((error: unknown) => {
        configurationPromise = null;
        throw error;
      });
  }
  return configurationPromise;
}

let lastWake = 0;
const WAKE_INTERVAL_MS = 60_000;

/**
 * Nudge the identity provider awake without waiting for it, at most once a
 * minute. Called when the login page loads, so a provider that scales to zero
 * (Cloud Run) is ready by the time the person presses "Sign in".
 */
export function wakeIdentityProvider(now = Date.now()): boolean {
  if (!config.oidc || now - lastWake < WAKE_INTERVAL_MS) return false;
  lastWake = now;
  const url = `${config.oidc.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  void fetch(url, { signal: AbortSignal.timeout(config.oidc.timeoutSeconds * 1000) }).catch(() => {
    // Best effort only; the sign-in itself waits and reports problems.
  });
  return true;
}

/** Test hook: forget cached discovery/JWKS state. */
export function resetOidcClientCache(): void {
  configurationPromise = null;
  jwks = null;
  lastWake = 0;
}

export interface AuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Build the IdP authorization URL (Authorization Code + PKCE S256 + state + nonce). */
export async function buildAuthorizationRequest(): Promise<AuthorizationRequest> {
  const settings = requireOidcSettings();
  const configuration = await getOidcConfiguration();

  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: settings.redirectUri,
    scope: settings.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url, state, nonce, codeVerifier };
}

export interface CodeExchangeResult {
  claims: Record<string, unknown> & { sub: string };
  idToken: string;
}

/**
 * Exchange the authorization code and validate the ID token (signature,
 * issuer, audience, expiry, nonce) — all enforced by `openid-client`.
 */
export async function exchangeCode(
  callbackUrl: URL,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<CodeExchangeResult> {
  const configuration = await getOidcConfiguration();
  const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims || !tokens.id_token) {
    throw new AppError(401, 'SSO_FAILED', 'The identity provider did not return an ID token.');
  }
  return { claims: claims as CodeExchangeResult['claims'], idToken: tokens.id_token };
}

/** RP-initiated logout URL at the IdP, or null when the IdP does not support it. */
export async function buildLogoutUrl(idTokenHint: string | null): Promise<string | null> {
  const settings = requireOidcSettings();
  const configuration = await getOidcConfiguration();
  if (!configuration.serverMetadata().end_session_endpoint) {
    return null;
  }
  const params: Record<string, string> = {
    post_logout_redirect_uri: settings.postLogoutRedirectUri,
    client_id: settings.clientId,
  };
  if (idTokenHint) {
    params.id_token_hint = idTokenHint;
  }
  return oidc.buildEndSessionUrl(configuration, params).href;
}

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export interface LogoutTokenClaims {
  sub?: string;
  sid?: string;
}

/**
 * Validate an OIDC Back-Channel Logout token (OpenID Connect Back-Channel
 * Logout 1.0, section 2.6): signature via the IdP's JWKS, issuer, audience,
 * `iat`, the logout event, no `nonce`, and at least one of `sub` / `sid`.
 */
export async function verifyLogoutToken(logoutToken: string): Promise<LogoutTokenClaims> {
  const settings = requireOidcSettings();
  const configuration = await getOidcConfiguration();
  const metadata = configuration.serverMetadata();
  if (!metadata.jwks_uri) {
    throw new AppError(400, 'SSO_LOGOUT_INVALID', 'Identity provider has no JWKS.');
  }
  jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri));

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(logoutToken, jwks, {
      issuer: metadata.issuer,
      audience: settings.clientId,
      requiredClaims: ['iat'],
      maxTokenAge: '10m',
    }));
  } catch {
    throw new AppError(400, 'SSO_LOGOUT_INVALID', 'Invalid logout token.');
  }

  const events = payload.events as Record<string, unknown> | undefined;
  const hasEvent =
    events !== undefined &&
    typeof events === 'object' &&
    events !== null &&
    typeof events[BACKCHANNEL_LOGOUT_EVENT] === 'object';
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
  const sid = typeof payload.sid === 'string' ? payload.sid : undefined;

  if (!hasEvent || payload.nonce !== undefined || (!sub && !sid)) {
    throw new AppError(400, 'SSO_LOGOUT_INVALID', 'Invalid logout token.');
  }
  return { sub, sid };
}
