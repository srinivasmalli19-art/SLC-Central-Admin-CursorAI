# SLC Central Admin — Integration Matrix (Phase 0)

> Read-only assessment of how each discovered application could be integrated
> into the central admin platform via the **adapter pattern**. Facts not
> verifiable from source are `UNKNOWN`. No integration is claimed to "work" —
> nothing has been runtime-tested.

## 1. Integration capability matrix

| Application | Has server API? | Integration mechanism | Auth for adapter | Health check | Statistics source | User management | Credential requirement | Difficulty | Blockers / risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Stock Management** (FieldOps) | Yes (Express REST + `/health`) | **HTTP API adapter** | App JWT (access/refresh) via service account | `/health` (confirmed in `render.yaml`) | Express endpoints (routes `UNKNOWN`) | Likely (RBAC + admin roles) — routes `UNKNOWN` | Service account + API base URL | **Low** | Route list not enumerated; multi-tenant (`siteCode`) must be respected |
| **SLC Vet** (Smart Livestock Care) | Yes (FastAPI `/api/*` + OpenAPI `/docs`) | **HTTP API adapter (OpenAPI-driven)** | JWT via `/api/auth/login` (service account) | `/docs` reachable (Render `healthCheckPath`) | `/api/admin/dashboard-stats`, `/api/admin/stats` (behavior unverified) | No enable/disable endpoint observed (`UNKNOWN`) | Service account + backend base URL | **Low–Medium** | Hardcoded JWT fallback secret in source; no API versioning; CORS pinned to slcvet.com |
| **Pasumithra** | No public REST API (Next server actions only) | **Firebase Admin SDK adapter** (or request new admin endpoints — needs approval) | Firebase service account (server-side only) | `UNKNOWN` (no health endpoint observed) | Firestore queries (data model `UNKNOWN`) | Firebase Auth `updateUser({disabled})` | Firebase service account for its project | **Medium–High** | Highly privileged SA; no API boundary; Firestore model unknown |
| **JeevaMitra** | No custom REST API (Firebase direct + FCM functions) | **Firebase Admin SDK adapter** | Firebase service account (project `jeevamitra`) | `UNKNOWN` | Firestore queries (data model `UNKNOWN`) | Firebase Auth `updateUser({disabled})` | Firebase service account (project `jeevamitra`) | **Medium–High** | Highly privileged SA; client-direct architecture; Firestore model unknown |
| **SLC GPS Camera** | No (on-device only) | **Registry metadata only** | None | `N/A` | None | None | None | **N/A** | Nothing server-side to administer |
| **SLC Apps Portal** | No (static site) | **Registry metadata only** | None | Optional URL ping (`slcvet.com`) | None | None | None | **N/A** | Content site, not an administrable app |

## 2. Adapter capability support (planned, per app)

`Y` = feasible from what was observed, `?` = needs verification, `N` = not
supported / not applicable.

| Capability | Stock Mgmt | SLC Vet | Pasumithra | JeevaMitra | GPS Camera | Portal |
| --- | --- | --- | --- | --- | --- | --- |
| `getApplicationInfo()` | Y | Y | Y | Y | Y (static) | Y (static) |
| `getApplicationHealth()` | Y (`/health`) | Y (`/docs`) | ? | ? | N | ? (URL ping) |
| `getStatistics()` | ? (routes) | ? (`/api/admin/*`) | ? (Firestore) | ? (Firestore) | N | N |
| `getUsers()` | ? | ? | Y (Firebase Auth) | Y (Firebase Auth) | N | N |
| `disableUser()` / `enableUser()` | ? | N (not observed) | Y (Admin SDK) | Y (Admin SDK) | N | N |

## 3. Recommended integration order

Ordered by **lowest risk / highest readiness first**, so the adapter framework
is proven against clean HTTP APIs before tackling Firebase-privileged targets.

1. **Stock Management (FieldOps)** — *first live integration (Phase 6).*
   Cleanest match: HTTP REST, `/health`, PostgreSQL/Prisma + JWT/RBAC that
   mirror the central stack. Lowest integration risk once routes are enumerated.
2. **SLC Vet** — *second.* Well-defined FastAPI + OpenAPI and existing
   `/api/admin/*` endpoints make an HTTP adapter straightforward; slightly higher
   risk due to the hardcoded-secret/no-versioning caveats to work around (without
   modifying the external repo).
3. **Pasumithra** — *third.* First Firebase Admin SDK adapter; introduces the
   privileged-service-account pattern with a smaller/simpler Firestore surface.
4. **JeevaMitra** — *fourth.* Second Firebase adapter, larger data model and more
   moving parts (FCM, multiple platforms).
5. **SLC GPS Camera** and **SLC Apps Portal** — *registry-only* at any time; add
   as metadata entries with no live adapter (health `N/A`/URL ping).
6. **NearSip / jeevamitra-app / Stock Management Android / any other apps** —
   *deferred* until repositories/APIs are located and access is granted
   (see `SLC-OPEN-QUESTIONS.md`).

## 4. Cross-cutting prerequisites before Phase 6

- Dedicated **service accounts / API keys** per app and per environment (never a
  human admin login), stored only in the central backend.
- Confirmed **base URLs** per environment for HTTP targets.
- **Firebase service accounts** (approved) for JeevaMitra/Pasumithra.
- Enumerated **route lists** / OpenAPI specs for HTTP targets.
- Explicit approval that Firebase Admin SDK management of live projects is
  authorized.
