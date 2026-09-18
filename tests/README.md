# Tests

The Phase 1 testing foundation keeps tests **colocated** with the code they
cover, which is the idiomatic layout for the chosen tools (Vitest):

- **API** (`apps/api`) — Vitest + Supertest:
  - `src/config/env.test.ts` — configuration validation.
  - `src/modules/health/health.test.ts` — application startup + `GET /api/v1/health`.
  - Run: `npm run test -w @slc/api`
- **Web** (`apps/web`) — Vitest + Testing Library (jsdom):
  - `src/App.test.tsx` — application shell renders and placeholder routing.
  - Run: `npm run test -w @slc/web`

Run everything from the repo root:

```bash
npm test          # all workspace test suites
npm run verify    # lint + typecheck + test + build (foundation gate)
```

This directory is reserved for future **cross-cutting / end-to-end** tests
(e.g. API + web integration) that do not belong to a single workspace. None
exist yet in Phase 1.
