# SLC Central Admin and central login in production (Render)

**Decision:** both run on **Render**, region **Singapore** (closest Render region
to India), from one Blueprint (`render.yaml` at the repo root):

| Service | What | Address | Size |
| --- | --- | --- | --- |
| `slcvet-id` | Keycloak, the central login with MFA | `https://slcvet-id.onrender.com` | 2 GB (Keycloak needs about 1.25 GB) |
| `slcvet-admin` | Central Admin: API and web app on one address | `https://slcvet-admin.onrender.com` | 512 MB |
| `slc-keycloak-db`, `slc-central-admin-db` | One PostgreSQL each | private to Render | smallest |

Custom domains (`id.slcvet.com`, `admin.slcvet.com`) can be added later; see
"Custom domains" below. Check current prices on render.com/pricing.

## What is in this folder

| File | What |
| --- | --- |
| `Dockerfile` | Keycloak 26.4.0, optimized build, production start, behind a proxy |
| `start.sh` | Starts Keycloak with its public address (from Render, or `KC_HOSTNAME`) |
| `realm-slc.prod.json` | The `slc` realm for production: no test accounts, no secrets; one first Super Admin whose email and temporary password come from the environment |
| `make-prod-realm.mjs` | Regenerates the production realm from `../realm-slc.json` (a test fails if they drift apart) |

## Go live, step by step

1. **Render account.** Sign up at render.com with GitHub, and let Render see
   the `SLC-Central-Admin-CursorAI` repository.
2. **Create everything.** Render → **New** → **Blueprint** → pick
   `SLC-Central-Admin-CursorAI` (branch `main`). Render shows the four
   resources and asks for one value:
   - `FIRST_SUPER_ADMIN_EMAIL`: your own email, in lower case.

   Press **Apply**. The first build takes about 10 minutes; Keycloak starts
   before Central Admin can sign anyone in.
3. **Check the addresses.** In Render, each service shows its address at the
   top. If they are exactly `https://slcvet-id.onrender.com` and
   `https://slcvet-admin.onrender.com`, go on. If Render added letters (the name
   was taken), see "If an address is different" below.
4. **Your temporary password.** Render → `slcvet-id` → **Environment** → reveal
   `FIRST_SUPER_ADMIN_TEMP_PASSWORD`.
5. **First sign-in.** Open `https://slcvet-admin.onrender.com` → **Sign in with
   SLC Account** → your email and the temporary password. Keycloak makes you
   choose your own password and add an authenticator app (Google
   Authenticator, Microsoft Authenticator…). You land on the Central Admin
   dashboard as Super Admin.
6. **Invite the others** from **Admin access**. Until an email service is set up
   (step 8), set each new person's temporary password in the Keycloak console:
   `https://slcvet-id.onrender.com/admin` → realm `slc` → Users → the person →
   Credentials → Set password (Temporary on).
7. **Keycloak console login.** User `slc-console-admin`; password in Render →
   `slcvet-id` → Environment → `KC_BOOTSTRAP_ADMIN_PASSWORD`. Later, replace it
   with a named admin with an authenticator (master realm → Users), then delete
   `slc-console-admin`.
8. **Email (later).** Keycloak console → realm `slc` → Realm settings → Email:
   your SMTP details. Then in Render → `slcvet-admin` → Environment set
   `KEYCLOAK_SEND_INVITE_EMAIL=true`, so invitations go out by email.

### If an address is different

The realm is imported once, at Keycloak's first start, with Central Admin's
address in it. If Render gave different addresses:

1. Render → `slcvet-admin` → Environment: set `OIDC_ISSUER_URL` to
   `<Keycloak address>/realms/slc`. Save (Central Admin restarts).
2. Render → `slcvet-id` → Environment: set `CENTRAL_ADMIN_URL` and
   `CENTRAL_ADMIN_API_URL` to the Central Admin address.
3. Because the realm was already imported, also fix it once in the Keycloak
   console: realm `slc` → Clients → `central-admin` → replace
   `https://slcvet-admin.onrender.com` with the real address in Valid redirect
   URIs, Valid post logout redirect URIs, Web origins and Backchannel logout
   URL. Save.

### Custom domains

1. Render → service → Settings → Custom domains: add `id.slcvet.com`
   (Keycloak) and `admin.slcvet.com` (Central Admin). In Cloudflare DNS add the
   CNAME records Render shows (proxied), SSL/TLS mode **Full (strict)**.
2. `slcvet-id` → Environment: `KC_HOSTNAME=https://id.slcvet.com`.
   `slcvet-admin` → Environment: `WEB_BASE_URL` and `API_BASE_URL` =
   `https://admin.slcvet.com`, `OIDC_ISSUER_URL=https://id.slcvet.com/realms/slc`.
3. Keycloak console → Clients → `central-admin`: add the new addresses as in
   "If an address is different".
4. Cloudflare → Security → WAF: block `/admin/master` and `/realms/master`
   except from your office IP. Do **not** block `/admin/realms/slc`.

### Backup (break-glass) password sign-in

Off at first (`PASSWORD_LOGIN_ENABLED=false`). To turn it on for one or two
named people: Render → `slcvet-admin` → Shell, for each person run
`BOOTSTRAP_ADMIN_EMAIL=<email> npm run bootstrap:admin` and
`npm run -w @slc/api mfa:enroll -- <email>`; then in Environment set
`PASSWORD_LOGIN_ENABLED=true` and `PASSWORD_LOGIN_ALLOWED_EMAILS=<emails>`.
`MFA_ENCRYPTION_KEY` is already generated; never change it afterwards.

## Later changes to the realm

The realm file is imported only when the realm does not exist yet. After the
first start, change roles, clients or policies in Keycloak (console, or from
Central Admin for people and their roles), and copy lasting changes back into
`../realm-slc.json` + `node make-prod-realm.mjs` so a rebuild matches.

## Backups and updates

- Render PostgreSQL keeps automatic backups; check the retention for your plan
  and do a test restore once.
- To update Keycloak, change the version in both `FROM` lines, test, then
  deploy (Render → Manual deploy).
- Checked on 22 Oct 2026: this realm imported into Keycloak 26.4.0; the first
  Super Admin signed in through Central Admin served on one address, choosing
  a new password and authenticator as required.
