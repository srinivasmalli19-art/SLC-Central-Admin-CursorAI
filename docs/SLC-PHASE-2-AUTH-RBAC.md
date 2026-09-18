# SLC Central Admin — Phase 2: Authentication & RBAC

This document describes the Central Admin authentication and role-based access
control (RBAC) system introduced in Phase 2.

> Scope: this system is the **Central Admin platform's own** administrative
> identity system. It is completely independent of end-user identities in
> external SLC applications (JeevaMitra, Pasumithra, SLC Vet, Stock Management,
> NearSip, ...). No external application is integrated in this phase.

## 1. Authentication architecture

- Email + password authentication for **administrators only**.
- Passwords are hashed with **argon2id** (`@node-rs/argon2`); plaintext is never
  stored or logged.
- On successful login the API creates a **server-side session** and returns an
  **httpOnly session cookie** plus a readable **CSRF cookie**. The browser holds
  no tokens in JavaScript-accessible storage.
- Authentication and authorization are enforced by centralized middleware
  (`requireAuth`, `requirePermission`) — never duplicated in controllers.
- Authentication events are emitted through a single choke point
  (`recordAuthEvent`) as structured, secret-free logs, ready for Phase 4 to
  persist as audit logs.

## 2. Session / token strategy

- **Server-side opaque sessions** (`AdminSession` table). A high-entropy random
  token is generated per login; only its **SHA-256 hash** is stored. The raw
  token lives solely in the httpOnly cookie.
- Cookie attributes are **explicitly configured and validated** (not derived
  solely from `NODE_ENV`): `COOKIE_SECURE`, `COOKIE_SAMESITE` (default
  `strict`), `COOKIE_DOMAIN`, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`.
  Production/staging startup **fails** if `COOKIE_SECURE` is not `true`.
- **Logout** deletes the session row (true invalidation). **Disabling** an admin
  revokes all their sessions and is also enforced on every request by
  `requireAuth`. **Password change** revokes all sessions.
- **CSRF**: double-submit pattern. A readable `slc_csrf` cookie must be echoed in
  the `X-CSRF-Token` header on authenticated state-changing requests; combined
  with `SameSite=Strict` on the session cookie. Login is exempt (no session yet).

## 3. Admin user model (`AdminUser`)

| Field | Notes |
| --- | --- |
| `id` | uuid primary key |
| `email` | unique, stored lower-cased |
| `passwordHash` | argon2id hash (never returned to clients) |
| `name` | optional display name |
| `status` | `ACTIVE` \| `DISABLED` (indexed) |
| `mfaEnabled` | MFA extension point (default false; not implemented) |
| `lastLoginAt` | updated on successful login |
| `createdAt` / `updatedAt` | timestamps |

Relations: `AdminUser` ↔ `Role` (via `AdminUserRole`), `AdminUser` →
`AdminSession`. No application-user or Firebase-user tables exist.

## 4. Role model (`Role`)

`id`, unique `key` (e.g. `SUPER_ADMIN`), `name`, `description`, timestamps.
Roles are seeded from shared configuration. Join to permissions via
`RolePermission`.

## 5. Permission model (`Permission`)

`id`, unique `key` (e.g. `applications.view`), `description`. The permission
catalog is defined once in `@slc/shared` (`PERMISSIONS`) and is **additive** —
new permissions require no architectural change. Effective permissions for an
admin are the union of the permissions of all their roles, resolved server-side.

Permission catalog: `applications.view/manage`, `users.view/manage`,
`content.view/manage`, `notifications.view/send`, `reports.view/export`,
`monitoring.view`, `audit_logs.view`, `admin_users.view/manage`, `system.manage`.

## 6. Role → permission mapping

Single source of truth: `ROLE_PERMISSIONS` in `@slc/shared` (used by the seed).

| Role | Permissions |
| --- | --- |
| `SUPER_ADMIN` | **all** permissions (granted explicitly; no hardcoded bypass) |
| `APP_ADMIN` | `applications.view/manage`, `monitoring.view`, `reports.view` |
| `CONTENT_ADMIN` | `content.view/manage`, `notifications.view/send` |
| `SUPPORT_ADMIN` | `users.view/manage`, `applications.view`, `monitoring.view`, `notifications.view` |
| `REPORT_VIEWER` | `reports.view`, `reports.export` |

`admin_users.manage` and `system.manage` are held by `SUPER_ADMIN` only.

## 7. Password policy

Practical and security-focused (see `validatePasswordPolicy`):

- Minimum **12** characters, maximum 200.
- Must not be blank or equal to the email address.
- **No** restrictive composition rules (a long passphrase is fine).

## 8. Bootstrap procedure (first SUPER_ADMIN)

There is **no default password** anywhere. The first administrator is created
by a dev-safe script:

```bash
# 1. Apply migrations and seed roles/permissions
npm run prisma:migrate        # dev  (prod: npm run prisma:migrate:deploy)
npm run db:seed

# 2. Create the first SUPER_ADMIN (interactive prompt if env vars unset)
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='<strong-secret>' \
  npm run bootstrap:admin
```

Safeguards: the script refuses to run if a SUPER_ADMIN already exists, requires
roles to be seeded first, validates the password policy, and **refuses to run in
production/staging** unless `--allow-production` is passed explicitly.

**Production bootstrap** (documented separately from dev defaults): run
`prisma migrate deploy` and `db:seed` against the production database, then run
the bootstrap with credentials supplied securely (secret manager / interactive
prompt) and the `--allow-production` flag — never using development defaults and
never committing credentials.

## 9. SUPER_ADMIN lifecycle protection

- Only actors with `system.manage` may **assign** the `SUPER_ADMIN` role
  (defense-in-depth beyond the `admin_users.manage` route permission).
- The system refuses to **disable** or **remove the SUPER_ADMIN role from** the
  **last active SUPER_ADMIN** (HTTP 409 `LAST_SUPER_ADMIN`).
- Disabling an admin immediately revokes their sessions.
- These safeguards are covered by integration tests.

## 10. API endpoints

All under `/api/v1`. Standard envelopes (`{ ok, data }` / `{ ok, error }`).

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| POST | `/auth/login` | public (rate-limited) | — |
| POST | `/auth/logout` | session + CSRF | — |
| GET | `/auth/me` | session | — |
| POST | `/auth/change-password` | session + CSRF | — |
| GET | `/admin-users` | session | `admin_users.view` |
| POST | `/admin-users` | session + CSRF | `admin_users.manage` |
| PATCH | `/admin-users/:id/status` | session + CSRF | `admin_users.manage` |
| PUT | `/admin-users/:id/roles` | session + CSRF | `admin_users.manage` |
| GET | `/health` | public | — |

## 11. Protected routes (frontend)

- `/login` is public. All other routes are behind `RequireAuth` (redirect to
  `/login` when unauthenticated; an initialization state while the session is
  resolved).
- Placeholder module routes are additionally wrapped in `RequirePermission`,
  which renders a **Forbidden (403)** page when the admin lacks the module
  permission. Navigation items are hidden for missing permissions.
- **Frontend permission checks are UX only.** The backend enforces every
  permission independently, so a direct API call or direct URL cannot bypass
  authorization.

## 12. Testing strategy

- **Unit tests (no DB):** password hashing/verify, password policy,
  role→permission invariants, configuration validation.
- **Integration tests (require Postgres via `TEST_DATABASE_URL`):** run against a
  dedicated test database prepared by a Vitest global setup (migrate + seed).
  Suites skip themselves when `TEST_DATABASE_URL` is unset.
- Covered scenarios include: unauthenticated rejected; authenticated succeeds;
  disabled admin cannot authenticate; permitted access allowed; unpermitted
  denied; SUPER_ADMIN has admin permissions; REPORT_VIEWER denied admin ops;
  logout invalidates session; invalid credentials rejected; login rate limiting;
  CSRF enforcement; and all SUPER_ADMIN lifecycle safeguards.

Commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

A manual security verification checklist (unauthenticated access, authenticated
access, forbidden API access, logout/session invalidation, disabled-admin
session invalidation, malformed requests, browser secret exposure, and server
log secret exposure) was executed against a running instance.

## 13. Future MFA extension

The architecture is MFA-ready without implementing MFA in this phase:

- `AdminUser.mfaEnabled` is the persistence extension point (default false).
- The login service has a clearly marked branch point where, when
  `mfaEnabled` is true, a future factor (e.g. TOTP) would issue a challenge and
  defer session creation until the second factor is verified.
- No MFA provider is added and no MFA secret columns are stored yet.

## 14. Development setup

```bash
npm install
cp .env.example .env            # set DATABASE_URL; keep COOKIE_SECURE=false for local http
npm run prisma:migrate          # apply migrations (creates auth/RBAC tables)
npm run db:seed                 # seed roles + permissions
npm run bootstrap:admin         # create the first SUPER_ADMIN (prompts if no env vars)
npm run dev                     # API :4000  +  Web :5173
```

Environment variables added in Phase 2 (see `.env.example`):
`SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `COOKIE_SAMESITE`,
`COOKIE_DOMAIN`, `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MIN`,
`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and (tests) `TEST_DATABASE_URL`.
Never commit real secrets; only `.env.example` placeholders are tracked.
