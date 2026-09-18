# SLC Central Admin — Phase 3: Application Registry

The Application Registry is the central catalog of the applications in the SLC
ecosystem. Phase 3 is **metadata and registry infrastructure only**.

> HARD BOUNDARY: the registry never connects to, authenticates against, or calls
> any external application backend (Firebase, Supabase, MongoDB, external
> Postgres, external APIs). It stores no secrets and no external business data.
> There are zero external backend calls in Phase 3 (proven by test).

## 1. Registry architecture

- A single Prisma model, `Application`, in the central PostgreSQL database holds
  descriptive metadata about each ecosystem application.
- The API exposes versioned, permission-gated CRUD-without-delete endpoints
  under `/api/v1`, reusing the Phase 2 authentication/RBAC middleware.
- The web app adds an Applications section (list, detail, create/edit) and
  surfaces DB-derived counts on the dashboard.
- Source of truth for seeded metadata is the Phase 0 discovery documents
  (`docs/SLC-ECOSYSTEM-INVENTORY.md`, `SLC-INTEGRATION-MATRIX.md`). Anything
  Phase 0 marked UNKNOWN is stored as `NULL` and rendered as `UNKNOWN`.

## 2. Application model

`Application` (table `application`), all metadata, no secrets:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | string, **unique** | lowercase kebab-case identity |
| `name` | string | |
| `description` | string? | |
| `platform` | string? | e.g. "Web", "Flutter (Android)" |
| `frontendTechnology` / `backendTechnology` / `databaseTechnology` / `authenticationTechnology` | string? | null ⇒ UNKNOWN |
| `repositoryUrl` | string? | |
| `productionUrl` / `stagingUrl` | string? | |
| `environment` | `DeploymentEnvironment` | default `UNKNOWN` |
| `integrationType` | `IntegrationType` | default `NONE` |
| `adapterType` | string? | |
| `integrationStatus` | `IntegrationStatus` | default `NOT_STARTED` |
| `status` | `AppStatus` | default `UNKNOWN` |
| `version` | string? | |
| `healthCheckEnabled` | boolean | default `false` (monitoring is a later phase) |
| `createdAt` / `updatedAt` | timestamps | |

Indexes: `status`, `integrationType`, `integrationStatus`. No external
application user/business tables are created.

## 3. Status enums

- `AppStatus`: `DEVELOPMENT`, `STAGING`, `PRODUCTION`, `MAINTENANCE`,
  `DEPRECATED`, `UNKNOWN`. Production is never inferred without documented
  evidence.
- `DeploymentEnvironment`: `DEVELOPMENT`, `STAGING`, `PRODUCTION`, `UNKNOWN`.
- `IntegrationStatus`: `NOT_STARTED`, `PLANNED`, `CONFIGURED`, `TESTING`,
  `CONNECTED`, `DEGRADED`, `DISCONNECTED`, `NOT_APPLICABLE`. **`PLANNED` means a
  future intended integration only** — it is never treated as connected,
  configured, testing, or operational. Nothing is `CONNECTED` in Phase 3.

## 4. Integration types

`IntegrationType`: `API`, `FIREBASE_ADMIN`, `SUPABASE`, `REGISTRY_ONLY`,
`PENDING`, `NONE`. These describe how the central platform will *eventually*
integrate; no adapter is implemented in Phase 3.

## 5. API endpoints

All under `/api/v1`, all require authentication. Standard envelopes.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/applications` | `applications.view` |
| GET | `/applications/:id` | `applications.view` |
| GET | `/applications-stats` | `applications.view` |
| POST | `/applications` | `applications.manage` (+ CSRF) |
| PATCH | `/applications/:id` | `applications.manage` (+ CSRF) |

No `DELETE` endpoint exists — deprecate via `status=DEPRECATED` instead of
destructive deletion. `GET /applications` supports `page`, `pageSize` (max 100),
`q`, `status`, `integrationType`, `integrationStatus`, `platform`, `sortBy`
(`name|createdAt|status`), `sortDir` (`asc|desc`).

## 6. RBAC

Reuses the Phase 2 permissions `applications.view` and `applications.manage`
(held by `SUPER_ADMIN` and `APP_ADMIN`; `SUPPORT_ADMIN` has view only). No new
roles were created and no `requireAuth`/`requirePermission` checks are bypassed.
Backend authorization is authoritative; the frontend hides affordances only for
UX. A direct API call without the permission returns 403.

## 7. Seed data

`prisma/seedApplications.ts` idempotently upserts the six known applications by
`slug` (safe to run repeatedly). Only documented Phase 0 facts are used; UNKNOWN
values are stored as `NULL`.

| slug | status | integrationType | integrationStatus | productionUrl |
| --- | --- | --- | --- | --- |
| slc-vet | UNKNOWN | API | PLANNED | — |
| stock-management | UNKNOWN | API | PLANNED | — |
| pasumithra | UNKNOWN | FIREBASE_ADMIN | PLANNED | — |
| jeevamitra | UNKNOWN | FIREBASE_ADMIN | PLANNED | — |
| slc-gps-camera | UNKNOWN | REGISTRY_ONLY | NOT_APPLICABLE | — |
| slc-apps-portal | PRODUCTION | REGISTRY_ONLY | NOT_APPLICABLE | https://slcvet.com |

`SLC Apps Portal` is the only entry with a production status/URL, based on the
documented Phase 0 evidence that its site is hosted at slcvet.com. No secrets,
guessed URLs, versions, or unverified production data are seeded.

## 8. UI

- `/applications` — searchable, filterable, sortable, paginated table (Name,
  Platform, Backend, Database, Status, Integration, Integration status).
- `/applications/:id` — detail with Overview, Technology, Repository &
  deployment, Integration & status. Null fields render as `UNKNOWN`.
- `/applications/new` and `/applications/:id/edit` — create/edit form, shown only
  to users with `applications.manage` (UX); the backend enforces the permission.
- Dashboard shows DB-derived registry counts (Total, Production, Development,
  Registry-only, Pending integrations); when the DB is unavailable it shows
  `DATA NOT CONNECTED` rather than fabricated numbers. No health status is shown.

## 9. Search / filter / pagination

- Search (`q`) matches name, slug, and description (case-insensitive).
- Filters: `status`, `integrationType`, `integrationStatus`, `platform`.
- Sort: `name`, `createdAt`, or `status`, ascending/descending.
- Pagination: 1-based `page` with `pageSize` (default 20, capped at 100);
  responses include `{ items, page, pageSize, total, totalPages }`.

Pending integrations count = applications whose `integrationType` is not
`REGISTRY_ONLY`/`NONE` and whose `integrationStatus` is not
`CONNECTED`/`NOT_APPLICABLE`.

## 10. Security

- No secrets are ever stored in `Application` records (no passwords, API keys,
  Firebase/Supabase keys, DB passwords, or JWT secrets).
- All endpoints require authentication; writes require `applications.manage` and
  a valid CSRF token; inputs are validated with Zod.
- No external network calls are made by any registry operation (verified by a
  test that asserts `fetch` is never called).

## 11. Future adapter architecture

The registry is the metadata foundation for a later adapter layer. `integrationType`
and `adapterType` describe the *intended* mechanism per application (HTTP/OpenAPI
for SLC Vet and Stock Management; Firebase Admin SDK for Pasumithra and
JeevaMitra; registry-only for GPS Camera and the Portal). Adapters,
credentials, health checks, and live connectivity are explicitly out of scope
for Phase 3 and will be introduced in later phases behind the central backend
security boundary.

## 12. Known unresolved applications

Per Phase 0, these were not accessible and are **not** seeded as known
applications; they remain documented as unresolved (see
`docs/SLC-OPEN-QUESTIONS.md`):

- **NearSip** — no accessible repository found.
- **jeevamitra-app** — distinct from the `Jeevamitra` repo; not located.
- **Stock Management Android** — only the web repo was found.

They can be added to the registry once their details are established, without
schema changes.

## 13. Migration strategy

- Development: `npm run prisma:migrate` (creates/apply dev migrations); the
  registry migration is `add_application_registry`.
- Production: `npm run prisma:migrate:deploy` (no production migration is run in
  this phase).
- Seed after migrating: `npm run db:seed` (idempotent; seeds roles, permissions,
  and the six known applications).
- The registry migration is additive (a new `application` table plus enums) and
  does not alter the Phase 2 auth/RBAC tables.
