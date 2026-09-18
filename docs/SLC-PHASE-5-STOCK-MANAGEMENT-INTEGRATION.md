# SLC Central Admin — Phase 5: Stock Management Integration (5A + 5B)

This phase implements only **5A (mandatory security hardening)** and **5B (Stock
Management adapter foundation)**. Tags: **CONFIRMED** (from source), **UNKNOWN**,
**PROPOSED** (future), **DEFERRED** (approval-gated).

> HARD BOUNDARY (enforced): **no live connection has occurred**. Phase 5A/5B make
> **zero external network calls** and store **no credentials**. Only mock/stub
> HTTP is used in tests. 5C–5E are NOT implemented and require explicit approval.

## Status of key facts

- **UNKNOWN** — Stock Management deployed **API base URL** (frontend is
  `logitask.in`; the API service host is not in source). Not added to any
  allow-list.
- **UNKNOWN** — whether a **staging** API host exists.
- **UNKNOWN** — a **read-only credential mechanism**. Source confirms only
  email/password → JWT; there is no read-only role or API-key/service-token.
- **CONFIRMED** — the current **Super_Admin** mechanism is **over-privileged**
  for a read-only integration (it can also write). Using it is DEFERRED and
  needs explicit approval.
- **CONFIRMED** — no live health/monitoring/user retrieval has been performed.

## 5A — Mandatory security hardening (implemented, Central Admin only)

1. **Runtime-environment gating** (`apps/api/src/integration/integration.service.ts`):
   `testConnection()` now rejects when `integration.environment !== runtimeEnvironment`
   **before** resolving credentials, selecting an adapter, or making any request,
   and never sets a live/CONNECTED status. Tests cover dev→dev (allowed),
   dev→staging (rejected), dev→prod (rejected), staging→prod (rejected),
   prod→prod (allowed), asserting the adapter and credential resolver are not
   invoked on mismatch.
2. **DNS-rebinding-safe SSRF** (`apps/api/src/integration/ssrf.ts`): added
   `isBlockedIp()` and `assertResolvedIpsAllowed()` — every **resolved IP** is
   validated (reject loopback, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
   incl. metadata, CGNAT, `0/8`, IPv6 `::1`/`fe80::/10`/`fc00::/7`, and
   IPv4-mapped). Fail-closed on empty/blocked resolution.
3. **Single guarded HTTP client** (`apps/api/src/integration/http/safeHttpClient.ts`):
   `SafeHttpClient` owns URL validation, DNS resolution + resolved-IP validation,
   a strict **redirect policy** (each hop re-validated, fail-closed), timeout,
   response-size limit, correlation-ID propagation, and safe error normalization
   (never leaks bodies/headers/tokens). External adapters must use this client;
   a static test guard asserts the Stock adapter does not use `fetch`/`http`/
   `https`/`axios`/`undici` directly.
4. **Egress allow-list** (`INTEGRATION_EGRESS_ALLOWLIST`, validated in
   `config/env.ts`): **fail-closed** (empty by default). The real Stock host is
   **not** added (it is UNKNOWN); `.env.example` shows placeholders only.
5. **Error safety**: `SafeHttpClient` and the adapter emit only normalized
   `IntegrationError`s with static, secret-free messages; upstream bodies/
   headers/tokens/cookies never enter errors, logs, `IntegrationEvent`, or
   `lastError`.

## 5B — Stock Management adapter foundation (implemented, no live calls)

- **`StockManagementAdapter`** (`adapterType: stock-management-http`), registered
  in `AdapterRegistry` with a `SafeHttpClient` bound to the **fail-closed**
  egress allow-list (so registration initiates no connection).
- **Read-only capabilities only:** `connection.validate`, `application.statistics`,
  `users.list`, `application.info`. No `users.disable`/`enable` or any write.
- **CONFIRMED endpoints mapped:** `GET /health`, `GET /api/monitoring`,
  `GET /api/users`, `GET /api/organisations` (+`/:id`). No unconfirmed endpoints.
- **Strict response schemas** (zod) for each; malformed JSON/shape →
  `MALFORMED_RESPONSE` (arbitrary upstream JSON is never passed through).
- **Error mapping:** 401→`UNAUTHORIZED` (non-retryable, single bounded re-auth),
  403→`FORBIDDEN`, 404→`NOT_FOUND`, 429→`RATE_LIMITED`, 5xx→`UPSTREAM_5XX`,
  network→`NETWORK`, timeout→`TIMEOUT`, invalid JSON/schema→`MALFORMED_RESPONSE`.
- **Authentication abstraction** (`auth.ts`): `StockAuthProvider` with
  `NoAuthProvider` (public `/health`), `StaticTokenAuthProvider` (future
  read-only API key), and `PasswordLoginAuthProvider` (current CONFIRMED
  email/password→JWT mechanism). Token lifecycle: access token cached
  **in memory only**, single-flight login (no refresh storm), bounded auth
  failure, no persistence, never logged. A future read-only service token drops
  in via `StaticTokenAuthProvider` **without redesign**.
- **Credential security:** credentials come only via the existing
  `CredentialResolver` (env-pinned), never stored in Application metadata, never
  returned in DTOs, never logged, never in events.

## Tenant isolation (CONFIRMED)

Stock Management is **multi-tenant, organization-scoped**. **Super_Admin =
global** (orgId null); **all other roles = own organization** (enforced by
`requireOrg` and query `where.orgId`). The adapter **preserves `orgId`** on
normalized users and **does not merge across organizations**. Central Admin must
not assume global visibility — data scope follows the integration credential's
role. Tests assert org identifiers are preserved and distinct orgs are not
silently merged.

## Testing (all mocks/stubs; zero external calls)

134 API tests pass, including: SafeHttpClient (allow-list, DNS rebinding,
loopback/link-local/metadata, redirect re-validation, timeout, size limit,
correlation ID, no real fetch), resolved-IP validation, environment-gating
matrix, and the Stock adapter (contract/capabilities, health/monitoring/users/
organisations success, 401/403/404/429/500, timeout, malformed JSON/schema,
retryable vs non-retryable, tenant isolation, credential/secret redaction,
correlation ID, password-login lifecycle, SSRF/DNS-rebinding, and a static guard
that the adapter cannot import unrestricted network clients).

## 5C gate (NOT implemented — all required before any live request)

1. 5A complete ✔ · 2. 5B complete ✔ · 3. read-only credential mechanism approved
(**UNKNOWN**) · 4. non-production API host confirmed (**UNKNOWN**) · 5. egress
allow-list configured for that host · 6. runtime env matches integration env ·
7. credential env matches runtime · 8. tenant/data scope documented ✔ ·
9. rollback/kill switch tested ✔ · 10. explicit approval given. **A credential
being present is NOT authorization to make a live request.**

## Rollback

Per-application, instant: **kill switch** (`enabled=false`), **credential
revocation** (`CredentialReference.status=REVOKED`), **environment config**
removal, **adapter disablement**. Disabling Stock Management cannot affect other
registered applications (all state is `applicationId`-scoped).

## Deferred / not implemented

5C live (non-prod) connection, 5D read-only validation, 5E production
enablement; real credential provisioning; Super_Admin service account; API-key/
service-token creation; any external application change; production allow-list
entry; health monitoring; user-operation proxying; write operations.
