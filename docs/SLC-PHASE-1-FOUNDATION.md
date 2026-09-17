# SLC Central Admin — Phase 1 Foundation

This document describes the Phase 1 foundation of the **SLC Central Admin**
platform: a clean monorepo containing a React + TypeScript + Vite web shell, a
Node + TypeScript + Express API, and a PostgreSQL + Prisma database foundation.

> Phase 1 is **foundation only**. There is no authentication, RBAC, application
> adapter, or external integration yet — those belong to later phases. No fake
> application data is shown anywhere.

## 1. Project structure

```
/
├── apps/
│   ├── api/                      # Node + TypeScript + Express API
│   │   ├── src/
│   │   │   ├── config/env.ts     # Centralized, validated configuration
│   │   │   ├── lib/logger.ts     # Structured logging (pino)
│   │   │   ├── db/prisma.ts      # Prisma client + connectivity probe
│   │   │   ├── errors/AppError.ts
│   │   │   ├── http/responses.ts # Standard success/error envelopes
│   │   │   ├── middleware/       # errorHandler, notFound, validate (zod)
│   │   │   ├── modules/health/   # health service/controller/routes
│   │   │   ├── routes/v1.ts      # Versioned API router (/api/v1)
│   │   │   ├── app.ts            # Express app factory
│   │   │   └── index.ts          # Bootstrap + graceful shutdown
│   │   └── vitest.config.ts
│   └── web/                      # React + TypeScript + Vite web shell
│       ├── src/
│       │   ├── components/       # AppLayout, Header, Sidebar, states, ...
│       │   ├── pages/            # Dashboard, NotFound
│       │   ├── lib/api.ts        # Typed API client (fetch + envelopes)
│       │   ├── App.tsx           # Routing
│       │   └── main.tsx
│       └── vite.config.ts        # Dev server + /api proxy + vitest config
├── packages/
│   └── shared/                   # @slc/shared — types & constants
├── prisma/
│   ├── schema.prisma             # Central DB schema (infrastructure only)
│   └── migrations/               # Migration history (initial migration)
├── tests/                        # Cross-cutting/e2e tests (reserved)
├── docs/
├── .env.example
├── eslint.config.js              # Flat ESLint config (monorepo-wide)
├── tsconfig.base.json
└── package.json                  # npm workspaces + orchestration scripts
```

### Architectural layering

The API separates concerns so business logic never lives inside route handlers:

- **Presentation / transport:** `routes/`, `modules/**/**.routes.ts`,
  `modules/**/**.controller.ts`, `http/responses.ts`.
- **Business logic:** `modules/**/**.service.ts`.
- **Data access:** `db/prisma.ts` (repository/data layer entry point).
- **Configuration:** `config/env.ts` (validated once, imported everywhere).
- **Infrastructure / cross-cutting:** `lib/logger.ts`, `middleware/`,
  `errors/`.

The design is intentionally modular so later phases add new domain modules
(`auth`, `applications`, `users`, `audit-logs`, ...) under `modules/` and mount
them on the `/api/v1` router without restructuring.

## 2. Technology choices

| Concern | Choice | Notes |
| --- | --- | --- |
| Monorepo | npm workspaces | No extra tooling; `apps/*` + `packages/*` |
| Language | TypeScript (strict) | Shared `tsconfig.base.json` |
| Frontend | React 18 + Vite 5 + react-router 6 | Fast dev server, `/api` proxy |
| Backend | Node 20+ + Express 4 | Modular controller/service/data layering |
| Validation | Zod | Env + request validation foundation |
| Logging | pino / pino-http | Structured logs, secret redaction |
| Security | helmet, cors, express-rate-limit | Baseline hardening |
| Database | PostgreSQL | Central admin data only |
| ORM | Prisma 5 | Migration workflow established |
| Tests | Vitest (+ Supertest, Testing Library) | API + web |
| Lint | ESLint 9 (flat) + typescript-eslint | Monorepo-wide |

Rationale: this matches the approved Phase 0 direction and mirrors the
in-ecosystem reference stack (Stock Management / FieldOps), minimizing novelty
and risk.

## 3. Local development setup

Prerequisites: Node.js >= 20, npm, and a PostgreSQL instance.

```bash
# 1. Install dependencies (all workspaces)
npm install

# 2. Configure environment
cp .env.example .env
#   edit .env and set DATABASE_URL to your local PostgreSQL

# 3. Set up the database (generate client + run migrations)
npm run prisma:generate
npm run prisma:migrate           # applies migrations to your dev DB

# 4. Run API + web together (web proxies /api to the API)
npm run dev
#   API  -> http://localhost:4000  (health: /api/v1/health)
#   Web  -> http://localhost:5173
```

You can also run them independently: `npm run dev:api` / `npm run dev:web`.

## 4. Environment variables

Defined in `.env.example` (placeholders only — never commit real secrets):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` / `staging` / `production` / `test` |
| `PORT` | no | `4000` | API listen port |
| `API_BASE_URL` | no | `http://localhost:4000` | Public API base URL |
| `WEB_BASE_URL` | no | `http://localhost:5173` | Web origin (CORS allow-list) |
| `DATABASE_URL` | prod: **yes** | — | PostgreSQL connection string (central DB) |
| `LOG_LEVEL` | no | `info` | pino log level |

Configuration is validated once at startup in `apps/api/src/config/env.ts`;
invalid values fail fast with a clear, secret-free message. `DATABASE_URL` is
required in production. The API and Prisma share a single repo-root `.env`
(tests run hermetically and do not read `.env`).

## 5. Database setup

- The central database holds **only** central-administration data and is fully
  independent of every external application database.
- Phase 1 defines infrastructure only: `prisma/schema.prisma` contains a single
  `AppMeta` (key/value) table used to bootstrap the schema and prove the
  migration workflow. **No** business/domain models (admin users, roles,
  applications, audit logs, ...) exist yet.
- Migration workflow:
  - `npm run prisma:validate` — validate the schema.
  - `npm run prisma:generate` — generate the Prisma client.
  - `npm run prisma:migrate` — create/apply a dev migration.
  - `npm run prisma:migrate:deploy` — apply migrations in staging/production.
- The initial migration lives in `prisma/migrations/` and is committed.

## 6. API structure

- All routes are versioned under `/api/v1`.
- Consistent response envelopes (`packages/shared`): success is
  `{ ok: true, data }`; errors are `{ ok: false, error: { code, message, details? } }`.
- Centralized error handling sanitizes unexpected errors (no internal details
  leak); operational `AppError`s carry a safe status/code/message.
- Baseline security: `helmet`, CORS restricted to `WEB_BASE_URL`, and rate
  limiting on the `/api/v1` surface.

### Endpoints (Phase 1)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/health` | Reports service status, application name, API version, environment, timestamp, uptime, and database connectivity (`connected` / `disconnected` / `unknown`). |

Example response:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "application": "SLC Central Admin",
    "version": "v1",
    "environment": "development",
    "timestamp": "2026-09-17T08:21:05.195Z",
    "uptimeSeconds": 8,
    "dependencies": { "database": "connected" }
  }
}
```

## 7. Frontend structure

- Responsive admin shell: dark sidebar navigation + header + content area
  (collapsible sidebar with scrim on small screens).
- Navigation is derived from `NAV_MODULES` in `@slc/shared`, so routes and the
  sidebar never drift. Only **Dashboard** is implemented; all other modules
  render a clearly-labelled **"Coming in a later phase"** placeholder.
- The Dashboard shows an **API connectivity** card that calls
  `GET /api/v1/health` and renders loading, error (with retry), and ready
  states. No fabricated statistics are shown; unavailable integrations will
  explicitly display `DATA NOT CONNECTED` in later phases.

### Routes

| Path | Component | Status |
| --- | --- | --- |
| `/` | Dashboard | Implemented (health widget) |
| `/applications` | ComingSoon | Placeholder |
| `/users` | ComingSoon | Placeholder |
| `/content` | ComingSoon | Placeholder |
| `/notifications` | ComingSoon | Placeholder |
| `/reports` | ComingSoon | Placeholder |
| `/monitoring` | ComingSoon | Placeholder |
| `/audit-logs` | ComingSoon | Placeholder |
| `/settings` | ComingSoon | Placeholder |
| `*` | NotFound | Fallback |

## 8. Testing commands

```bash
npm test                 # run all workspace test suites
npm run test -w @slc/api # API tests only (Vitest + Supertest)
npm run test -w @slc/web # Web tests only (Vitest + Testing Library)
```

Coverage in Phase 1:

- **API:** configuration validation (`env.test.ts`), application startup +
  `GET /api/v1/health` + secure headers + sanitized 404
  (`health.test.ts`).
- **Web:** app shell renders and placeholder routing (`App.test.tsx`).

## 9. Build commands

```bash
npm run build            # build shared, then api (tsc), then web (tsc + vite)
npm run build:shared     # build @slc/shared only
npm run typecheck        # type-check all workspaces
npm run lint             # ESLint across the monorepo
npm run verify           # lint + typecheck + test + build (foundation gate)
```

Production start (after build + migrations):

```bash
npm run prisma:migrate:deploy
node apps/api/dist/index.js       # start API
npm run preview -w @slc/web       # preview the built web bundle
```

## 10. Architectural decisions

1. **Monorepo with npm workspaces** — one repo for web, api, and shared types
   keeps the foundation simple; no extra monorepo tooling was introduced.
2. **Shared types package (`@slc/shared`)** — a single source of truth for API
   contracts (health payload, response envelopes) and navigation, consumed by
   both api and web to prevent drift.
3. **ESM + NodeNext for the API** — modern module system; relative imports use
   `.js` specifiers so the compiled output runs natively on Node.
4. **Config validated once, at the edge** — `config/env.ts` is the only place
   that reads `process.env`; everything else imports a typed object.
5. **Layered API (routes → controller → service → data)** — business logic is
   kept out of Express handlers to stay testable and ready for growth.
6. **Honest health/degradation model** — a missing database degrades (not
   downs) the foundation API and is reported truthfully; nothing is faked.
7. **Security baked in from the start** — helmet, CORS allow-list, rate
   limiting, sanitized errors, and secret redaction in logs. Full auth/RBAC is
   deferred to Phase 2 by design.
8. **Infrastructure-only DB schema** — the migration workflow is proven with a
   neutral `AppMeta` table; no business/domain models are introduced early.

## 11. Security checks (Phase 1)

- Secrets: only `.env.example` (placeholders) is committed; `.env` is
  git-ignored; no credentials, keys, or service accounts are in the repo.
- Headers: `helmet` verified (e.g. `X-Content-Type-Options: nosniff`,
  `X-Frame-Options`, HSTS) on API responses.
- CORS restricted to the configured web origin.
- Rate limiting active on `/api/v1`.
- Errors sanitized; internal details are logged server-side only.
- Environment validated at startup; `DATABASE_URL` required in production.

## 12. What is intentionally NOT in Phase 1

Authentication, RBAC, application registry, adapters, audit logging, user
management, notifications/reporting implementations, dashboards with real
metrics, and any external integration or deployment. These follow in later
phases per the approved phased execution model.
