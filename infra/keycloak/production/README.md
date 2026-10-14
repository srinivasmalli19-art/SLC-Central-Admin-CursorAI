# SLC central login in production (Keycloak on Render)

**Decision:** Keycloak runs on **Render**, region **Singapore** (closest Render
region to India), as a Docker web service with its own Render PostgreSQL, at
**`https://id.slcvet.com`** behind Cloudflare. Render already hosts the SLC Vet
and Stock Management backends, handles HTTPS certificates and deploys, and runs
managed PostgreSQL with backups, so there is no server to patch.

Size: a **2 GB** instance (Keycloak needs about 1.25 GB to run); the database
can start small. Check current prices on render.com/pricing.

## What is in this folder

| File | What |
| --- | --- |
| `Dockerfile` | Keycloak 26.4.0, optimized build, production start, behind a proxy |
| `realm-slc.prod.json` | The `slc` realm for production: **no test accounts, no secrets**; secrets and app URLs come from environment variables at first start |
| `make-prod-realm.mjs` | Regenerates the production realm from `../realm-slc.json` (a test fails if they drift apart) |
| `../../../render.yaml` | Render Blueprint creating the database and the Keycloak service |

Checked on 14 Oct 2026: this realm imported into Keycloak 26.4.0 started in
production mode, and the live check passed 13/13 (2 checks skipped because
they need the dev-only test admin).

## Deploy, step by step

1. **Render → New → Blueprint**, pick the `SLC-Central-Admin-CursorAI`
   repository. Render reads `render.yaml` and asks for:
   - `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`: a temporary
     Keycloak console login (long random password, keep it in a password manager);
   - `STOCK_API_URL`: the Stock Management backend's base URL (where
     `/api/auth/sso/...` lives);
   - `PASUMITHRA_ADMIN_URL`: the Pasumithra admin portal's URL.

   **Every app URL must be set.** If one is empty Keycloak refuses to start
   ("A redirect URI is not a valid URI") — on purpose, so a half-configured
   server never comes up. If an app has no live address yet, put its planned
   address.
2. **Domain:** in the Render service → Settings → Custom domains, add
   `id.slcvet.com`. In Cloudflare DNS add the `CNAME id → <service>.onrender.com`
   it shows (proxied), and set SSL/TLS mode to **Full (strict)**.
3. **First start** imports the realm (about a minute). Check
   `https://id.slcvet.com/realms/slc/.well-known/openid-configuration` loads.
4. **Lock down the Keycloak console:**
   - sign in at `https://id.slcvet.com/admin` with the bootstrap login, create
     a named admin in the `master` realm, give it the `admin` role, sign in as
     it, set up its authenticator (Account → Signing in), then delete the
     temporary bootstrap admin;
   - in Cloudflare → Security → WAF, add a custom rule: **Block** when
     *URI Path starts with `/admin/master`* or *starts with `/realms/master`*,
     unless the request comes from your office IP. Do **not** block
     `/admin/realms/slc` — Central Admin uses it (with its own service account).
5. **Email:** Keycloak console → realm `slc` → Realm settings → Email: add your
   SMTP details, so invitation and password-reset emails go out.
6. **Connect Central Admin:** copy the generated `KC_SECRET_CENTRAL_ADMIN` and
   `KC_SECRET_CENTRAL_ADMIN_API` from the Render service's Environment page into
   Central Admin's settings:
   ```
   OIDC_ISSUER_URL=https://id.slcvet.com/realms/slc
   OIDC_CLIENT_ID=central-admin
   OIDC_CLIENT_SECRET=<KC_SECRET_CENTRAL_ADMIN>
   KEYCLOAK_ADMIN_CLIENT_ID=central-admin-api
   KEYCLOAK_ADMIN_CLIENT_SECRET=<KC_SECRET_CENTRAL_ADMIN_API>
   # Backup (break-glass) password sign-in — see docs/SLC-CENTRAL-SSO.md
   PASSWORD_LOGIN_ENABLED=true
   PASSWORD_LOGIN_ALLOWED_EMAILS=<one or two named people>
   MFA_ENCRYPTION_KEY=<openssl rand -base64 32>
   ```
7. **First real admin:** on the Central Admin server create the break-glass
   account and its authenticator (`bootstrap:admin`, then `mfa:enroll`), sign
   in with it, and invite everyone else from **Admin access** — they get an
   email to set their own password and authenticator app.
8. **Prove it:** run the live check from a machine that can reach Keycloak,
   against a **staging** copy rather than production (it creates and deletes
   one test admin): `KEYCLOAK_URL=https://<staging> npm run -w @slc/api keycloak:live-check`.

## Later changes to the realm

The realm file is imported only when the realm does not exist yet. After the
first start, change roles, clients or policies in Keycloak (console, or from
Central Admin for people and their roles), and copy lasting changes back into
`../realm-slc.json` + `node make-prod-realm.mjs` so a rebuild matches.

## Backups and updates

- Render PostgreSQL keeps automatic backups; check the retention for your plan
  and do a test restore once.
- To update Keycloak, change the version in both `FROM` lines, run the live
  check against staging, then deploy (Render → Manual deploy).
