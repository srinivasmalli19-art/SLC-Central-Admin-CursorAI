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

---

# Step 2: Admin access managed from Central Admin

Central Admin now manages the SLC admin accounts held in Keycloak: invite,
per-app roles, disable, sign out everywhere, resend the set-up email. Every
change and every sign-in is written to a new audit log.

## Keycloak service account

The realm has a new confidential client, `central-admin-api`, with
`serviceAccountsEnabled` and only these `realm-management` roles:
`view-users`, `manage-users`, `query-users`, `query-groups`, `view-clients`,
`query-clients`. It has no browser login.

| Variable | Default | Notes |
| --- | --- | --- |
| `KEYCLOAK_ADMIN_CLIENT_ID` | — | `central-admin-api` |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | — | from the secret manager |
| `KEYCLOAK_BASE_URL` / `KEYCLOAK_REALM` | derived from `OIDC_ISSUER_URL` | set explicitly if the issuer URL is not `<base>/realms/<realm>` |
| `KEYCLOAK_MANAGED_APPS` | all SLC app clients | `clientId=Display name` pairs, comma-separated |
| `KEYCLOAK_SEND_INVITE_EMAIL` | `true` | needs SMTP configured in the realm |

## API (`/api/v1`)

| Method | Path | Permission | What |
| --- | --- | --- | --- |
| GET | `/identity/apps` | `admin_users.view` | managed apps and their roles |
| GET | `/identity/users?search=` | `admin_users.view` | admins with per-app roles, groups, MFA status |
| POST | `/identity/users` | `admin_users.manage` | invite (email, names, `appRoles`) |
| PUT | `/identity/users/:id/roles` | `admin_users.manage` | set the roles of each listed app |
| PATCH | `/identity/users/:id/status` | `admin_users.manage` | enable / disable (disable also signs out everywhere) |
| POST | `/identity/users/:id/logout` | `admin_users.manage` | sign out of every app |
| POST | `/identity/users/:id/resend-invite` | `admin_users.manage` | re-send set-password + MFA email |
| GET | `/audit-logs`, `/audit-logs/actions` | `audit_logs.view` | audit log, newest first |

Safeguards (server-side): granting Central Admin `SUPER_ADMIN`, or changing or
disabling an existing Super Admin, needs `system.manage`; the last enabled Super
Admin (direct or via group) cannot be demoted or disabled; nobody can disable
themselves.

Invited admins get `UPDATE_PASSWORD`, `CONFIGURE_TOTP` and `VERIFY_EMAIL` as
required actions, so they set their own password and authenticator app; no
password is ever chosen by another admin.

## Audit log

Migration `20261014100000_add_audit_log` adds `audit_log`. `recordAuthEvent`
(all sign-in, logout, role and SSO events) now also writes there, and every
identity change is recorded with actor, target and a secret-free summary.
Keys that look like secrets are dropped from metadata before saving.

## Web

- **Admin access** (`/users`): admins, status (active, MFA, invite pending),
  access per app, and Invite / Edit access / Sign out everywhere / Disable.
- **Audit Logs** (`/audit-logs`): filter by action or actor email.

## Tests

`identity.test.ts` runs the API against an in-memory imitation of the Keycloak
Admin REST API (`test/fakeKeycloakAdmin.ts`): listing, inviting (with and
without working email), role validation, partial role updates, all Super Admin
safeguards, disable-signs-out-everywhere, and CSRF. `AdminAccess.test.tsx`
covers the page.

---

# Steps 3–5: every SLC app's admin access through SLC

| App | How admins get in | Where the work lives |
| --- | --- | --- |
| SLC Central Admin | SLC sign-in (OIDC, server-side) | this repo |
| Stock Management | "Sign in with SLC Account" → app verifies the token, issues its own session | Stock-management-Web, branch `feat/slc-sso` |
| Pasumithra admin portal | "Sign in with SLC Account" → **Firebase bridge** (this API) → Firebase custom token | pasumithra-Web-application, branch `feat/slc-sso` |
| JeevaMitra | Managed **inside Central Admin** (no admin UI in the app) | this repo + rules fix in Jeevamitra |
| NearSip | Managed **inside Central Admin**; in-app admin with hardcoded password removed | this repo + NearSip branch |
| Pasunestam | "Sign in with SLC Account" for editors/admins (server-side, Next.js) | pasunestam, branch `feat/slc-sso` |

## Per-app roles inside Central Admin

The `central-admin` client now also puts every app's roles in the ID token
(`resource_access.<client>.roles`). They are saved on the admin at each SSO
sign-in (`admin_user.appRoles`, migration `20261014130000_admin_app_roles`)
and checked by `requireAppRole(clientId, roles)`. Central Admin roles alone do
not grant access to an app's data: a person needs a role in that app.

## Firebase bridge (`modules/bridge`)

`POST /api/v1/bridge/firebase/:clientId/token` takes an SLC access token
issued to that app's client, verifies it, and returns a Firebase custom token
for `slc:<sub>` with `slc_admin`, `slc_roles`, `slc_email` claims. Per-app CORS
allow-list. `POST /api/v1/bridge/firebase/:clientId/backchannel-logout`
revokes that person's Firebase refresh tokens; disabling or signing someone out
in Admin access does the same for every bridged project.

```
FIREBASE_SA_PASUMITHRA=<base64 service account JSON>
FIREBASE_SA_JEEVAMITRA=<base64 service account JSON>
FIREBASE_BRIDGE_APPS=[
  {"clientId":"pasumithra-admin","serviceAccountEnv":"FIREBASE_SA_PASUMITHRA","origins":["https://<pasumithra admin portal>"]},
  {"clientId":"jeevamitra-admin","serviceAccountEnv":"FIREBASE_SA_JEEVAMITRA"}
]
```

An entry without `origins` is used only for server-side management (JeevaMitra).

## JeevaMitra (`/apps/jeevamitra`)

| SLC role (`jeevamitra-admin`) | Can |
| --- | --- |
| viewer | see counts, users, vets, disease alerts |
| admin | + verify / unverify vets (account **and** public vet profile), deactivate / reactivate disease alerts |
| super_admin | + disable a user's Firebase account (also signs them out) |

## NearSip (`/apps/nearsip`)

Uses Supabase REST with the service-role key (server only):

```
NEARSIP_SUPABASE_URL=https://<project>.supabase.co
NEARSIP_SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

| SLC role (`nearsip-admin`) | Can |
| --- | --- |
| viewer | see counts, places, reviews, users |
| admin | + add / edit / delete places, delete reviews |
| super_admin | + disable / enable a user (Supabase ban, reversible) |

Place edits accept only the fields the old in-app admin edited (`name`, `type`,
`address`, `latitude`, `longitude`, `rating`, `is_hotspot`, `is_verified`,
`is_popular`).

## Tests

`firebaseBridge.test.ts` (real custom-token signing with a generated service
account, CORS, forged/other-app tokens, back-channel logout) and
`apps/appModules.test.ts` (JeevaMitra with an in-memory store, NearSip against a
fake Supabase REST server; role gating, auditing, input allow-list).
