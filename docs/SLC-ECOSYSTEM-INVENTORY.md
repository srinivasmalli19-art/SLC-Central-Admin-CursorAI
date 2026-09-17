# SLC Ecosystem Inventory

> **Phase 0 — Discovery artifact.** This document records what was *observed* by
> read-only inspection of the accessible SLC repositories on
> **2026-09-17**. It intentionally does **not** invent missing facts. Any value
> that could not be verified from source is recorded as `UNKNOWN`.

## 1. How this inventory was produced

- The GitHub token available to this agent is a **scoped installation token**.
  It has **write** access only to the central repository
  (`srinivasmalli19-art/SLC-Central-Admin-CursorAI`) and **read** access to the
  owner's other **public** repositories via the public GitHub REST API.
- All other repositories were inspected in **READ-ONLY** mode: repository
  metadata, language breakdown, file trees, and the contents of manifest and
  configuration files (e.g. `package.json`, `pubspec.yaml`, `requirements.txt`,
  `firebase.json`, `render.yaml`, `prisma/schema.prisma`, `.env.example`,
  `README.md`). **No external repository was cloned, modified, or written to.**
- No secret values were read or copied. Firebase `projectId`/`appId` values are
  public client identifiers and are treated as non-sensitive; no private keys,
  service accounts, or database credentials were present in the inspected files.

## 2. Repositories discovered

Owner account inspected: **`srinivasmalli19-art`** (GitHub user).

| Repo | Maps to (SLC app) | Primary language | Last push (observed) |
| --- | --- | --- | --- |
| `SLC-Central-Admin-CursorAI` | **This central admin platform** (empty scaffold) | — | 2026-09-17 |
| `slc` | **SLC Vet** ("Smart Livestock Care") | JavaScript (frontend) + Python (backend) | 2026-03-02 |
| `pasunestam` | **Pasumithra** | TypeScript | 2026-09-14 |
| `Jeevamitra` | **JeevaMitra** | Dart (Flutter) | 2026-08-27 |
| `gps_map_camera_pro` | **SLC GPS Camera** | Dart (Flutter) | 2026-05-22 |
| `Stock-management-Web` | **Stock Management Web** (a.k.a. "FieldOps Manager") | JavaScript | 2026-06-29 |
| `SLC-Apps` | **SLC Apps Portal** (marketing site for slcvet.com) | JavaScript | 2026-07-16 |

Applications named in the mission brief but **not found** as accessible
repositories: **NearSip**, **jeevamitra-app** (distinct from `Jeevamitra`),
**Stock Management Android** (only the Web repo is present). See
`SLC-OPEN-QUESTIONS.md`.

## 3. Master inventory table

Columns use `UNKNOWN` wherever the fact could not be verified from source.

| Application | Repository | Platform | Frontend | Backend | Database | Authentication | Hosting | Production URL | API availability | Admin capabilities available today | Integration difficulty | Integration risks | Recommended integration method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **SLC Vet** (Smart Livestock Care) | `srinivasmalli19-art/slc` | Web | React 18 (Create React App + CRACO), Radix UI, Tailwind, react-router 7, recharts | FastAPI (Python 3.12), served by gunicorn + uvicorn workers | MongoDB (via `motor`/`pymongo`; `MONGO_URL`, `DB_NAME=slc_db`) | JWT (HS256) Bearer tokens, `bcrypt` password hashing; roles `farmer/paravet/veterinarian/admin/guest` | Backend on **Render** (`render.yaml`); frontend host `UNKNOWN` | `slcvet.com` is the SLC portal; app itself marked "coming soon". Backend service URL `UNKNOWN` | **Yes** — REST under `/api/*` + auto OpenAPI at `/docs`. Endpoints include `/api/auth/{register,login,me}`, `/api/admin/stats`, `/api/admin/dashboard-stats`, many `/api/vet/*` | `admin` role exists; `/api/admin/stats` and `/api/admin/dashboard-stats` endpoints exist (behavior not runtime-verified) | **Low–Medium** | JWT secret has an insecure hardcoded fallback in source; no API versioning; single large `server.py` (~5.5k lines); CORS pinned to slcvet.com | **HTTP API adapter** using service credentials + OpenAPI spec |
| **Stock Management Web** (FieldOps Manager) | `srinivasmalli19-art/Stock-management-Web` (`fieldops-manager/`) | Web | React 18 + Vite, TanStack Query, react-router 6, react-hook-form + zod | Node.js + Express (`server.js`), helmet, cors, express-rate-limit, morgan, winston, Joi | **PostgreSQL via Prisma** (`DATABASE_URL`); optional Redis (`ioredis`) | JWT **access + refresh** (`jsonwebtoken`), `bcrypt`, cookie-parser; RBAC roles `Super_Admin/Admin/Store_Manager/Team_Leader/Engineer` | **Render** (`render.yaml`: Node web service + static frontend); optional AWS S3/CloudFront | `logitask.in` referenced in `.env.example` (not confirmed live); service URL `UNKNOWN` | **Yes** — Express REST API + `/health`. Concrete route list `UNKNOWN` (not enumerated in Phase 0) | RBAC with `Super_Admin`/`Admin`; multi-tenant (`Organisation.siteCode`); admin UI `UNKNOWN` | **Low** | Route list not yet enumerated; multi-tenant model must be respected; auth is app-local | **HTTP API adapter**; also the **closest reference** for the central platform's own stack |
| **Pasumithra** | `srinivasmalli19-art/pasunestam` | Web | Next.js 16 + React 19 (App Router, Server Components/Actions) | Next.js server runtime + `firebase-admin` (server-only) | **Firestore** (server-only; client access denied by rules) | **Firebase Auth** (Identity Toolkit REST for sign-in + `firebase-admin` **session cookies**) | Firebase (Firestore/Storage/rules present); web host `UNKNOWN` (Firebase Hosting or Render) | Marketing page at `slcvet.com/apps/pasumithra`; app URL `UNKNOWN` | **No dedicated public REST API** — data reached only through Next server actions; **no admin API surface** | None exposed as an API; admin would require Firebase Admin SDK or new server endpoints | **Medium–High** | No API boundary for external admin; would need Firebase Admin service account (highly privileged) or new endpoints in the app repo (requires approval) | **Firebase Admin SDK adapter** (server-side, central backend only) OR request app owner to expose admin endpoints |
| **JeevaMitra** | `srinivasmalli19-art/Jeevamitra` | Flutter (Android, iOS, macOS, Web) | Flutter/Dart (Riverpod, go_router, Google Maps) | **Firebase** BaaS + **Cloud Functions** (Node 20, FCM delivery) | **Firestore** (+ Firebase Storage) | **Firebase Auth** | Firebase project **`jeevamitra`** (`appId` 1:360739375700:...); FCM; Crashlytics/Analytics/Performance | Mobile app (Google Play per portal); no web admin URL | **No custom REST API** — clients talk directly to Firebase; server logic is FCM Cloud Functions | None exposed as an API; admin would need Firebase Admin SDK against project `jeevamitra` | **Medium–High** | Requires a highly privileged Firebase service account; Firestore data model `UNKNOWN`; client-direct architecture | **Firebase Admin SDK adapter** (server-side, central backend only) |
| **SLC GPS Camera** | `srinivasmalli19-art/gps_map_camera_pro` | Flutter (Android) | Flutter/Dart (provider, camera, Google Maps) | **None** (fully on-device; uses Google Maps/geocoding APIs) | Local only (`shared_preferences`); no server DB | **None** (no user accounts observed) | Google Play (per portal) | Mobile app; no server URL | **None** — no backend, no API | None — nothing to administer centrally | **N/A (out of scope)** | No server-side surface to integrate; central admin can at most track metadata/version manually | **Registry metadata only** (no live adapter) |
| **SLC Apps Portal** | `srinivasmalli19-art/SLC-Apps` | Web (static marketing site) | React 19 + Vite, react-router 7, prerendered | None (static site) | None | None | **Cloudflare Pages** (GoDaddy = registrar only) | **`slcvet.com`** | None (static) | None — content site only | **N/A (out of scope)** | Not an administrable application; useful as source of truth for app slugs/branding | **Registry metadata only** (no live adapter) |
| **SLC Central Admin** (this repo) | `srinivasmalli19-art/SLC-Central-Admin-CursorAI` | Web (to be built) | Planned: React + TS + Vite | Planned: Node + TS + Express | Planned: PostgreSQL + Prisma | Planned: centralized JWT/session, RBAC, MFA-ready | Planned: Render + Cloudflare, `admin.slcvet.com` | `admin.slcvet.com` (planned) | To be built (`/api/v1/*`) | To be built | **N/A (build target)** | Greenfield; no code yet | **N/A** |

## 4. Technology totals across the ecosystem (observed)

- **Frontend web:** React (18 & 19), Vite, Create React App/CRACO, Next.js 16, Radix UI, Tailwind, TanStack Query.
- **Mobile:** Flutter/Dart (2 apps).
- **Backends:** FastAPI/Python (SLC Vet), Node/Express (Stock Management), Next.js server + firebase-admin (Pasumithra), Firebase Cloud Functions/Node 20 (JeevaMitra). None for GPS Camera / Portal.
- **Databases:** MongoDB (SLC Vet), PostgreSQL/Prisma (Stock Management), Firestore (Pasumithra, JeevaMitra).
- **Auth:** app-local JWT (SLC Vet, Stock Management), Firebase Auth (Pasumithra, JeevaMitra), none (GPS Camera, Portal).
- **Hosting:** Render (SLC Vet backend, Stock Management), Firebase (JeevaMitra), Cloudflare Pages (Portal). Several web-frontend hosts are `UNKNOWN`.
- **Third-party integrations observed:** Stripe, Google GenAI/OpenAI/litellm, AWS S3/boto3 (SLC Vet); Anthropic, Resend, Sentry (Pasumithra); Google Maps/Geocoding (Flutter apps).

## 5. What is verified vs. assumed

- **Verified from source:** languages, frameworks, package manifests, database
  drivers/ORMs, auth libraries, deployment descriptors (`render.yaml`,
  `firebase.json`), the SLC Vet REST route list, and the Pasumithra/JeevaMitra
  Firebase-only architecture.
- **Not verified (marked `UNKNOWN`):** live production/service URLs, whether the
  Render/Firebase deployments are currently running, exact Stock Management
  Express route list, Firestore data models, and the web hosts for several
  frontends. Runtime behavior of any endpoint was **not** exercised.
