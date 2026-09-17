# SLC Central Admin — Initial Architecture Notes (Phase 0)

> **Status:** Preliminary notes only. These are *observations and provisional
> recommendations* derived from Phase 0 discovery. They are **not** an approved
> architecture. The formal architecture document (`docs/SLC-CENTRAL-ARCHITECTURE.md`)
> is a **Phase 1** deliverable and must not be created until Phase 0 is approved.

## 1. Guiding principles confirmed by discovery

- The SLC ecosystem is genuinely **heterogeneous**: two Flutter apps (Firebase),
  two Firebase-backed web/mobile apps, one FastAPI+MongoDB app, one
  Node/Express+PostgreSQL app, plus static marketing. There is **no single
  shared identity system and no single database**. This validates the mission's
  core rule: **do not merge apps; integrate via adapters**.
- The central platform must be the **security boundary**. Two integration
  targets (JeevaMitra, Pasumithra) can only be administered through **highly
  privileged Firebase service accounts**, which must live **only** in the
  central backend and never reach the browser.
- The central admin's own preferred stack (Node + TS + Express + Prisma +
  PostgreSQL + JWT/RBAC) is **already proven inside the ecosystem** by
  `Stock-management-Web` / FieldOps Manager. That repo is the best in-house
  reference for structure, security middleware (helmet, cors, rate-limit),
  and RBAC.

## 2. Provisional target architecture (to be ratified in Phase 1)

```
 Browser (admin.slcvet.com)                     <-- no privileged secrets ever
        |  HTTPS, short-lived access token
        v
 SLC Central Admin Web (React + TS + Vite, static on Render, Cloudflare in front)
        |  /api/v1/*  (versioned)
        v
 Central Admin Backend (Node + TS + Express)     <-- SECURITY BOUNDARY
        |  Auth/AuthZ (JWT + RBAC + MFA-ready)
        |  Application Registry
        |  Audit Logging
        |  Monitoring / Health
        |  Notifications (interfaces only in V1)
        |  Reporting (interfaces only in V1)
        |
        +-- Central PostgreSQL (Prisma)          <-- central admin data ONLY
        |
        +-- Adapter Layer (per-application)
              |
              +-- slc-vet         -> HTTP/OpenAPI adapter (REST + service JWT)
              +-- stock-management-> HTTP adapter (Express REST + service JWT)
              +-- jeevamitra      -> Firebase Admin SDK adapter (server-side)
              +-- pasumithra      -> Firebase Admin SDK adapter (server-side)
              +-- slc-gps-camera  -> registry metadata only (no backend)
              +-- (future apps)   -> new adapter module
```

## 3. Adapter architecture notes

- Define a single `ApplicationAdapter` interface. Adapters implement **only the
  capabilities their target actually supports** and declare unsupported
  operations explicitly (e.g. throw `NotSupportedError` / return a typed
  "capability not available" result) rather than faking data.
- Suggested capability surface (superset; per-adapter subset):
  `getApplicationInfo()`, `getApplicationHealth()`, `getStatistics()`,
  `getUsers()`, `getUser()`, `disableUser()`, `enableUser()`.
- **Adapter feasibility from discovery:**
  - **SLC Vet** — `getApplicationHealth()` via `/docs` (Render `healthCheckPath`),
    `getStatistics()` via `/api/admin/dashboard-stats` (pending runtime
    verification), auth via `/api/auth/login`. User enable/disable: `UNKNOWN`
    (no such endpoint observed).
  - **Stock Management** — health via `/health`; users/stats endpoints exist in
    an Express API but exact routes are `UNKNOWN` and must be enumerated before
    building the adapter.
  - **JeevaMitra / Pasumithra** — no REST API. Adapters would use the Firebase
    Admin SDK (Auth for user list/disable via `updateUser({disabled})`,
    Firestore for statistics). Requires a service account per project and is
    subject to the mission's "do not modify external repos without approval"
    rule (using Admin SDK is read/manage of a live project, not a repo change,
    but still needs explicit owner approval + credentials).
  - **SLC GPS Camera / SLC Apps Portal** — no backend; represented in the
    registry as metadata only, with health = `UNKNOWN`/`N/A`.

## 4. Central database scope (provisional)

Central PostgreSQL holds **only central administration data**, never copies of
application databases:

- `CentralAdminUser`, `Role`, `Permission` (RBAC, centralized permission
  definitions — no scattered hardcoded checks).
- `Application` (registry), `ApplicationConfig`, `AdapterConfig`,
  `IntegrationMetadata`.
- `AuditLog` (every privileged action; no secrets stored).
- `Notification`, `SystemSetting`, `HealthCheck` records.
- **Application-specific identities** kept as separate linked records
  (`AppIdentity` per app) — **never** merged into one global user table, and
  never linked on name alone.

## 5. Security posture observed (and to enforce centrally)

- **Positive patterns to reuse:** Stock Management already uses helmet, CORS
  allow-list, express-rate-limit, access/refresh token split, bcrypt.
- **Risks seen in targets (do not replicate):** SLC Vet ships an insecure
  **hardcoded JWT secret fallback** and has **no API versioning**; its CORS is
  pinned to `slcvet.com`. These are documented as integration risks, not to be
  "fixed" in the external repo during Phase 0.
- **Central mandates:** environment-based config only, `.env.example` (no real
  secrets), input/API validation, sanitized errors, secure headers, CORS
  allow-list, audit logging, short-lived tokens, MFA-ready, dev/staging/prod
  separation, and service credentials for adapters stored server-side only.

## 6. Deployment notes

- Initial target **Render** is already the norm for two backends; static
  frontends deploy well on Render/Cloudflare. Domain `admin.slcvet.com` sits
  behind Cloudflare (consistent with the Portal already on Cloudflare Pages).
- Keep environments `development` / `staging` / `production` with separate
  credentials; never use production secrets in development.

## 7. Explicitly out of scope for Phase 0

No dashboard, no migrations, no Prisma schema, no adapter code, no deployment,
no credential configuration, and no changes to any external application repo.
These begin only after Phase 0 approval, following the phased execution model.
