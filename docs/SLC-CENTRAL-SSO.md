# SLC Central SSO — Step 1: Keycloak + Central Admin sign-in

Every SLC administrator signs in once, at Keycloak, and that login is trusted by
Central Admin and (in later steps) every SLC app's admin area. This document
covers step 1: the Keycloak realm and the Central Admin integration.

Scope is **admin and staff identities only**. End users of the SLC apps keep
their existing login.

## 1. Rollout steps

| Step | What | Status |
| --- | --- | --- |
| 1 | Keycloak realm `slc` + Central Admin signs in through it | **This change** |
| 2 | Central Admin "Admin Users" page manages Keycloak users, app roles, disable + sign-out via the Keycloak Admin API | Next |
| 3 | Stock Management and SLC Vet backends validate Keycloak tokens | Planned |
| 4 | Pasumithra admin portal: Keycloak → Firebase custom-token exchange + Firestore rules | Planned |
| 5 | JeevaMitra (Flutter, PKCE) and NearSip (Supabase Keycloak provider) | Planned |
| 6 | Retire each app's old admin login; MFA mandatory everywhere | Planned |

## 2. How Central Admin signs in (backend-for-frontend)

The API performs the whole OpenID Connect exchange, so no IdP token ever reaches
browser JavaScript; the browser ends up with the same httpOnly session cookie
and CSRF cookie as a password login.

1. `GET /api/v1/auth/oidc/login?returnTo=/path` — generates `state`, `nonce` and a
   PKCE verifier (S256), stores them in a 10-minute httpOnly `SameSite=Lax`
   cookie scoped to `/api/v1/auth/oidc`, and redirects to Keycloak.
2. Keycloak authenticates the admin (password + TOTP) and redirects to
   `GET /api/v1/auth/oidc/callback`.
3. The API exchanges the code (client secret + PKCE verifier) and `openid-client`
   validates the ID token: signature (JWKS), issuer, audience, expiry, nonce, state.
4. Roles are read from the `roles` claim (configurable with `OIDC_ROLES_CLAIM`).
   Only known Central Admin role keys are kept; no role → access denied.
5. The local admin is found by `oidcSubject`, else linked by **verified** email,
   else provisioned as an SSO-only account (no password). Its role assignments
   are replaced by the token's roles (Keycloak is authoritative). A local
   `DISABLED` status still blocks sign-in.
6. A normal Central Admin session is created (with the IdP `sid` and an
   `id_token_hint`), cookies are set, and the browser is sent to `returnTo`
   (same-origin relative paths only).

Failures redirect to `/login?error=<code>` (`sso_failed`, `sso_no_access`,
`sso_account_disabled`, `sso_email_missing`, `sso_email_unverified`,
`sso_email_conflict`); details are logged server-side, never shown.

### Logout

- `POST /api/v1/auth/logout` ends the Central Admin session and, for SSO
  sessions, returns `ssoLogoutUrl` (Keycloak end-session with `id_token_hint`);
  the web app navigates there so the shared Keycloak session ends too.
- `POST /api/v1/auth/oidc/backchannel-logout` receives Keycloak's back-channel
  logout token, verifies it (JWKS signature, issuer, audience = client id,
  `iat` within 10 minutes, logout event present, no `nonce`, `sub` or `sid`
  present) and revokes the matching sessions.

### Other endpoints

- `GET /api/v1/auth/config` (public) — `{ passwordLoginEnabled, ssoEnabled, ssoProviderName }`,
  used by the login page to show the right buttons.
- `POST /api/v1/auth/login` — returns 403 `PASSWORD_LOGIN_DISABLED` when the
  deployment is SSO-only.
- `POST /api/v1/auth/change-password` — returns 409 `SSO_ACCOUNT` for SSO-only
  accounts (they change their password in Keycloak).

## 3. Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OIDC_ISSUER_URL` | with the next two | — | e.g. `https://id.slcvet.com/realms/slc`; must be https in production/staging |
| `OIDC_CLIENT_ID` | with SSO | — | `central-admin` |
| `OIDC_CLIENT_SECRET` | with SSO | — | from the secret manager |
| `OIDC_REDIRECT_URI` | no | `${WEB_BASE_URL}/api/v1/auth/oidc/callback` | must be registered in Keycloak |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | no | `${WEB_BASE_URL}/login` | must be registered in Keycloak |
| `OIDC_ROLES_CLAIM` | no | `roles` | dot path allowed, e.g. `resource_access.central-admin.roles` |
| `OIDC_SCOPES` | no | `openid email profile` | |
| `OIDC_PROVIDER_NAME` | no | `SLC Account` | login button label |
| `PASSWORD_LOGIN_ENABLED` | no | `false` with SSO, `true` without | keep `true` during migration or as break-glass |

Startup fails on partial OIDC settings, on an http issuer in production/staging,
and on `PASSWORD_LOGIN_ENABLED=false` without SSO.

## 4. Data model changes

Migration `20261014090000_add_central_sso`:

- `admin_user.passwordHash` is now nullable (SSO-only accounts).
- `admin_user.oidcSubject` (unique) links the account to Keycloak's `sub`.
- `admin_session.oidcSid` (indexed) and `admin_session.idTokenHint` support
  back-channel and RP-initiated logout.

## 5. Tests

- `apps/api/src/modules/auth/oidc/oidc.flow.test.ts` runs the full sign-in
  against a real OpenID Connect provider (`oidc-provider`) standing in for
  Keycloak, with an in-memory database fake, so it needs no PostgreSQL. It
  covers PKCE/state/nonce, provisioning, role mapping, rejected users, account
  linking, disabled accounts, state mismatch, single logout, and valid/forged
  back-channel logout tokens.
- `claims.test.ts` (role extraction, return-path sanitising) and new cases in
  `env.test.ts` (configuration validation).
- `apps/web/src/pages/Login.test.tsx` covers the SSO-only, mixed and error states
  of the login page.

## 6. Known limits of step 1

- The Admin Users page still creates local password accounts; step 2 moves admin
  management to Keycloak.
- Disabling a user in Keycloak blocks new sign-ins but does not by itself end
  open sessions; sign the user out in Keycloak (step 2 will do both).
- MFA is enforced in Keycloak, not re-checked by Central Admin (`mfaEnabled`
  stays false for SSO accounts).
- The realm file was written for Keycloak 26 and validated in tests against a
  standards-compliant OIDC server, not yet imported into a live Keycloak.
