# SLC Central Admin — Phase 4: Integration Foundation

Phase 4 builds the **secure integration foundation** so that future SLC
applications can be connected through isolated adapters without coupling the
central admin core to any application's backend.

> HARD BOUNDARY (enforced and tested): Phase 4 makes **zero external network
> calls**, stores **no secrets**, creates **no service accounts**, implements
> **no real adapters**, and selects **no production secrets manager**. Only the
> safe `mock` and `noop` adapters exist. No external Firebase/Supabase/MongoDB/
> PostgreSQL/API is contacted.

## Phase 3 vs Phase 4 vs future (read this first)

- **Phase 3 (existing, unchanged):** the Application Registry. `Application.integrationStatus`
  remains **declared/registry metadata** set by admins. Its API/UI behavior is
  untouched by Phase 4.
- **Phase 4 (this foundation):** per-environment `ApplicationIntegration`
  configuration, credential **references**, the adapter contract + registry +
  mock/noop adapters, the Integration Layer, the credential resolver, failure
  policies, SSRF primitives, integration-management APIs, and a new
  **system-authoritative** `ApplicationIntegration.connectionStatus`.
- **Future real integrations (later phases):** concrete adapters (Stock
  Management, SLC Vet, Pasumithra, JeevaMitra), a concrete secrets backend, live
  connectivity, health monitoring, and user-operation proxying. **Not built here.**

## 1. Integration architecture

```
Central Admin Core  ──►  Application Registry (Phase 3, metadata)
        │
        ▼
Integration Layer (IntegrationService)  ── owns config + system connection status
        │  resolves credential refs (env-pinned) · applies timeout/retry/circuit-breaker · SSRF guard
        ▼
Adapter (via AdapterRegistry)  ── mock/noop only in Phase 4
        ▼
External Application Systems  ── NOT contacted in Phase 4
```

The core depends only on the adapter **contract** (dependency inversion). The
Integration Layer is the sole component that would initiate outbound calls in a
future connecting phase.

## 2. Backward compatibility (Clarification 1)

`Application.integrationStatus` (Phase 3) is **not changed** — it stays declared
metadata. The new, separate `ApplicationIntegration.connectionStatus` holds the
future **system-derived** live state. The `Application` model only gains a
back-relation (`integrations`), which is additive and does not alter any Phase 3
column, API, or UI. The Phase 3 applications API and frontend continue to work
(verified: 14 registry tests pass, web bundle unchanged, runtime smoke shows 6
apps + stats intact).

## 3. Adapter contract & isolation

`ApplicationAdapter` (see `apps/api/src/integration/adapter/types.ts`):
`describeCapabilities()`, `validateConnection(ctx)`, and optional
capability-gated read/write ops. Adapters receive an injected `AdapterContext`
(`correlationId`, `environment`, `baseUrl`, `timeoutMs`, `signal`, resolved
`credentials`) — they never read secrets or `process.env` themselves.
`AdapterRegistry` maps `adapterType → adapter`; the core resolves adapters only
through it, so app-specific logic never enters the core. Phase 4 registers only
`MockAdapter` and `NoopAdapter`; real types (`http`, `firebase-admin`) are
intentionally unregistered so real systems cannot connect.

## 4. Credential reference design (Clarification 2)

`CredentialReference` is a **reference to** a secret, never the secret. It stores
`provider` (`ENV`|`SECRET_STORE`|`SECRETS_MANAGER`|`ENCRYPTED_DB`), a non-secret
`refKey`, `environment`, `scopes`, `version`, and `status`
(`ACTIVE`|`ROTATING`|`REVOKED`) — and **no value column**. Multiple named
references per integration are supported (`@@unique([applicationIntegrationId, name])`),
so an application can require several credentials/capabilities without redesign.
Secrets are resolved at call time by a `CredentialResolver`; values are held in
memory only, never logged, never returned by any API, never committed. Phase 4
wires only the `ENV` provider; **no concrete production secrets manager is
selected or implemented** (deferred). Rotation = versioned reference; revocation
= `status=REVOKED` (resolver refuses); auditability = `CREDENTIAL_ACCESSED`
events (value never included).

## 5. System-derived connection status (Clarification 3)

`ApplicationIntegration.connectionStatus` is **system-authoritative**. The
configuration API accepts only `adapterType`, `enabled`, `baseUrl`, `timeoutMs`,
and credential references — it **never accepts `connectionStatus`** (zod strips
it). Config derives only `NOT_CONFIGURED`/`CONFIGURED`. The live states
`TESTING`/`CONNECTED`/`DEGRADED`/`DISCONNECTED` are produced **only** by
`IntegrationService.testConnection()` after actual adapter execution. In Phase 4
only `mock` can reach `CONNECTED` (no external call); real external types remain
unconnected (`NOT_SUPPORTED` → `NOT_APPLICABLE`). This resolves the Phase 3
review finding without modifying Phase 3.

## 6. Environment isolation (Clarification 4)

Credential resolution always uses the **server runtime environment**
(`runtimeIntegrationEnvironment()`, derived from validated config), never a
request/path parameter. `CredentialResolver` enforces
`ref.environment === runtimeEnv` and throws `ENVIRONMENT_MISMATCH` otherwise, so
a development/staging server can never resolve production credentials. Verified
at runtime: testing a PRODUCTION integration on the dev runtime yields
`ENVIRONMENT_MISMATCH` and never resolves the production reference.

## 7. Failure handling

`apps/api/src/integration/policies.ts`: `withTimeout` (AbortController →
`TIMEOUT`), `withRetry` (exponential backoff + jitter, retryable-only,
injectable sleep/RNG), and `CircuitBreaker` (CLOSED/OPEN/HALF_OPEN with
injectable clock). The Integration Layer wraps adapter calls as
circuit-breaker → retry → timeout, plus a **kill switch** (`enabled=false`
short-circuits without calling the adapter). Errors are normalized to an
adapter-agnostic taxonomy (`IntegrationErrorCode`).

## 8. Security boundary

Session auth + RBAC (Phase 2) with new permissions `integrations.view`,
`integrations.manage`, `integrations.test`. Mutations require CSRF. Only the
Integration Layer invokes adapters and resolves credentials (audited). SSRF
primitives (`assertAllowedOutboundUrl`, `isBlockedHost`) reject private/
loopback/link-local/metadata ranges and non-allow-listed hosts before any future
outbound call. Logs redact secrets; integration events store only non-secret,
redacted detail. Credentials and config are scoped per application + environment.

## 9. API design

- **Phase 3 (implemented):** `/api/v1/applications*` (registry) — unchanged.
- **Phase 4 (implemented, non-connecting):**
  - `GET /api/v1/applications/:id/integrations` (`integrations.view`)
  - `GET /api/v1/applications/:id/integrations/:env` (`integrations.view`)
  - `GET /api/v1/applications/:id/integrations/:env/capabilities` (`integrations.view`)
  - `PUT /api/v1/applications/:id/integrations/:env` (`integrations.manage` + CSRF)
  - `POST /api/v1/applications/:id/integrations/:env/test` (`integrations.test` + CSRF)
- **Future (not implemented):** proxied application user-operations, live health.
  No DELETE endpoints are introduced.

## 10. Database design

New models (migration `add_integration_foundation`, additive):
- `ApplicationIntegration` — `(applicationId, environment)` unique; `adapterType`,
  `enabled`, `baseUrl`, system-only `connectionStatus`, discovered `capabilities`,
  `timeoutMs`, `lastTestedAt`, `lastError`.
- `CredentialReference` — reference-only (no secret value); `(integrationId, name)`
  unique; provider/refKey/environment/scopes/version/status.
- `IntegrationEvent` — non-secret audit/observability events.
Relationship: `Application (1) → (N) ApplicationIntegration (1) → (N) CredentialReference`.
The `Application` model is otherwise unchanged.

## 11. Environments

`IntegrationEnvironment` = `DEVELOPMENT`/`STAGING`/`PRODUCTION`. Integration
config and credential references are environment-scoped; credential resolution
is pinned to the runtime environment (see §6).

## 12. Testing

100 API tests pass, all with mocks/fakes and no external calls:
- Unit (no DB): timeout/retry/circuit-breaker (`policies.test.ts`), SSRF
  (`ssrf.test.ts`), credential resolver env/status guards (`resolver.test.ts`),
  adapter registry + mock/noop (`registry.test.ts`).
- Integration (test DB, mock/fake only, `integrations.integration.test.ts`):
  authentication; `integrations.view`/`manage`/`test`; CSRF; credential-reference
  isolation (no value); connection-status authority (client `CONNECTED`
  ignored); environment isolation (no prod creds on dev runtime); application
  isolation; unsupported/registry-only (`NOT_SUPPORTED`/`NOT_APPLICABLE`); kill
  switch; retry→CONNECTED, timeout→DEGRADED, fail→DISCONNECTED (service-level with
  MockAdapter); secret never persisted/exposed; and a `fetch` spy proving no
  external network calls.

Run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## 13. Observability

Structured pino logs with `correlationId`; `IntegrationEvent` rows for config
updates, credential access, and connection-test start/success/failure with
latency. Metrics and health monitoring are deferred.

## 14. Integration order (Phase 0 facts; proposed, may change)

Proposed future order: 1) Stock Management, 2) SLC Vet, 3) Pasumithra,
4) JeevaMitra. This is a **proposed sequence** and may change after runtime/API
validation. No application is connected in Phase 4.

## 15. Unresolved applications

`NearSip`, `jeevamitra-app`, and `Stock Management Android` remain unresolved per
Phase 0 and are not integrated; no details are invented.

## 16. Migration strategy

Additive only: new enums/models + Integration Layer + adapter contract +
mock/noop adapters + management APIs, none of which connect externally. A future
phase adds a real adapter behind the contract + a concrete credential backend +
an egress allow-list, enabled per environment and validated by a connection test
that sets the system status. The `Application` model and Phase 3 behavior remain
intact throughout.

## 17. Deferred decisions

Concrete secrets backend (`ENV` vs secret store vs manager vs encrypted DB);
metrics provider and health monitoring; user-operation proxying; per-application
admin scoping granularity; async/queued execution of long adapter calls.
