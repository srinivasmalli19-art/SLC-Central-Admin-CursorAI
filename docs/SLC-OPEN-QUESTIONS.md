# SLC Central Admin — Open Questions & Unverified Facts (Phase 0)

> These are the things that **could not be verified** during read-only Phase 0
> discovery, plus decisions that require **human input/approval** before later
> phases. Nothing here should be guessed or invented in code.

## 1. Missing / inaccessible repositories

1. **NearSip** — named in the brief but **no accessible repository** was found
   under `srinivasmalli19-art`. Where does it live (different owner/org, private,
   not on GitHub)? What is its stack, backend, and API?
2. **jeevamitra-app** — the brief lists this separately from `Jeevamitra`. Only
   `Jeevamitra` (Flutter) was found. Is `jeevamitra-app` a distinct repo, a
   rename, or the same project?
3. **Stock Management Android** — only `Stock-management-Web` was found. Is there
   a separate Android repo? Does it share the FieldOps PostgreSQL backend?
4. Are there **other apps/repos outside the visible account** (the brief says the
   list is "not necessarily limited to" the named apps)? Please grant read access
   or provide an inventory.

## 2. Access & credentials

5. The agent's GitHub token can **write only** to the central repo and **read**
   the owner's **public** repos. To integrate private/other-owner repos, will the
   central platform be granted **read-only** access (or provided OpenAPI specs)?
6. For **JeevaMitra** and **Pasumithra**, central administration requires
   **Firebase service accounts** (highly privileged). Who provisions these, for
   which projects/environments, and with what scoped permissions? (These must be
   stored only in the central backend.)
7. For **SLC Vet** and **Stock Management** HTTP adapters: will the central
   platform get **dedicated service accounts / API keys** (not a human admin
   login)? What are the live base URLs per environment?

## 3. Production URLs & environments (currently `UNKNOWN`)

8. Live **base URL** of the SLC Vet FastAPI backend (Render service URL)?
9. Live URL + host of the **SLC Vet React frontend** (host is `UNKNOWN`)?
10. Live URL of **Stock Management** (`logitask.in` appears in `.env.example` —
    is it live and production?) and its API base URL?
11. Host + URL of the **Pasumithra** web app (Firebase Hosting? Render?).
12. Confirm which apps are actually in **PRODUCTION** vs **DEVELOPMENT/STAGING**
    for the registry `status` field. The portal marks **SLC Vet as "coming
    soon"** while its code is substantial — which is authoritative?

## 4. API surface details needed before adapters

13. **Stock Management** Express **route list** (users, stats, health) — not
    enumerated in Phase 0; needed to design its adapter.
14. **SLC Vet**: confirmed runtime behavior and auth/roles for `/api/admin/stats`
    and `/api/admin/dashboard-stats`; is there any **user enable/disable**
    endpoint? (None observed.)
15. Do JeevaMitra/Pasumithra expose **any** server endpoints intended for admin
    use, or must all admin actions go through the Firebase Admin SDK?

## 5. Identity & data model

16. Is there **any reliable cross-application identity** (shared email, phone,
    external ID) that legitimately links the same person across apps? Per the
    mission, identities must **not** be merged without reliable evidence and
    **never** on name alone.
17. Firestore **data models** for JeevaMitra and Pasumithra are `UNKNOWN`. Needed
    before any statistics/reporting adapter work.

## 6. Notifications & reporting providers

18. Which **notification providers** are officially in scope for the central
    platform (FCM already used by JeevaMitra; Resend seen in Pasumithra; email
    provider for admin)? V1 builds interfaces only unless a provider is
    configured.
19. What **reports** are actually required first, and from which confirmed data
    sources? (No app-specific reports until the source is confirmed.)

## 7. Governance / approvals

20. Confirmation that using the **Firebase Admin SDK** against the live
    `jeevamitra`/Pasumithra projects (read + user-management) is approved —
    this manages live data even though it does not modify the app repos.
21. If any external repo ever needs a change (e.g. Pasumithra exposing an admin
    endpoint), that is an **explicit, separately approved** integration — confirm
    the process.
22. Confirm the **initial integration order** proposed in
    `SLC-INTEGRATION-MATRIX.md` before Phase 6.

## 8. Central platform specifics

23. Confirm the preferred stack (React+TS+Vite / Node+TS+Express / PostgreSQL+
    Prisma) — discovery found no reason to deviate. Any objection?
24. Confirm the **role hierarchy** (`SUPER_ADMIN`, `APP_ADMIN`, `CONTENT_ADMIN`,
    `SUPPORT_ADMIN`, `REPORT_VIEWER`) and the initial permission set.
25. MFA: which factor(s) for V1 (TOTP, email, SMS)? Architecture must be
    MFA-ready regardless.
