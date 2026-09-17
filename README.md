# SLC Central Admin

Centralized administration platform for the SLC application ecosystem.

> **Status: Phase 1 — Foundation.** This repository currently contains the
> platform *foundation* only: a web shell, an API with a health endpoint, and a
> PostgreSQL + Prisma database foundation. Authentication, RBAC, application
> adapters, and integrations arrive in later phases. No external application is
> integrated yet and no production data is shown.

## Stack

- **Web:** React + TypeScript + Vite (`apps/web`)
- **API:** Node + TypeScript + Express (`apps/api`)
- **Database:** PostgreSQL + Prisma (`prisma/`)
- **Shared types:** `@slc/shared` (`packages/shared`)
- Monorepo via npm workspaces.

## Quick start

```bash
npm install
cp .env.example .env          # then set DATABASE_URL
npm run prisma:generate
npm run prisma:migrate
npm run dev                   # API :4000  +  Web :5173
```

Open http://localhost:5173 and check the Dashboard's API connectivity card, or
call the health endpoint directly:

```bash
curl http://localhost:4000/api/v1/health
```

## Common scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API + web (web proxies `/api` to the API) |
| `npm run build` | Production build (shared → api → web) |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | ESLint across the monorepo |
| `npm test` | Run all test suites |
| `npm run verify` | lint + typecheck + test + build |

## Documentation

- Phase 1 foundation: [`docs/SLC-PHASE-1-FOUNDATION.md`](docs/SLC-PHASE-1-FOUNDATION.md)

Phase 0 ecosystem discovery artifacts (inventory, architecture notes,
integration matrix, open questions) live under `docs/` as well once the Phase 0
change is merged.

## Security

Never commit real secrets. Only `.env.example` (placeholders) is tracked; `.env`
is git-ignored. The browser never receives privileged credentials — the API is
the security boundary.
