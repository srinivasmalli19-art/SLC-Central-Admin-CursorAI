# Keycloak — central login for SLC admins

Keycloak is the single place every SLC administrator signs in. It holds admin
accounts, per-app roles, MFA and login events. Each SLC app trusts the OpenID
Connect tokens Keycloak signs instead of keeping its own admin passwords.

## Run it locally

```bash
docker compose -f infra/keycloak/docker-compose.yml up -d
```

| What | Where |
| --- | --- |
| Keycloak admin console | http://localhost:8080/admin (`admin` / `admin`, dev only) |
| SLC realm issuer | http://localhost:8080/realms/slc |
| SLC account self-service (password, MFA device) | http://localhost:8080/realms/slc/account |

The `slc` realm is imported from `realm-slc.json` on first start. To re-import
after editing the file, remove the volume: `docker compose -f infra/keycloak/docker-compose.yml down -v`.

## Sign in to Central Admin with it

1. In the repo-root `.env`, set:
   ```
   OIDC_ISSUER_URL=http://localhost:8080/realms/slc
   OIDC_CLIENT_ID=central-admin
   OIDC_CLIENT_SECRET=dev-only-central-admin-secret-change-me
   ```
2. Apply the new migration and make sure roles are seeded:
   `npm run prisma:migrate && npm run db:seed`
3. `npm run dev`, open http://localhost:5173 and choose **Sign in with SLC Account**.
4. Use `superadmin@slc.local` / `DevOnly-ChangeMe-2026`. Keycloak makes you set a
   new password and enrol an authenticator app (TOTP) on first sign-in.
   `support@slc.local` (same temporary password) gets the Support Admin role.

## What the realm contains

- **Clients (one per app):** `central-admin` (confidential), `pasumithra-admin`,
  `jeevamitra-admin`, `slcvet-admin`, `stock-admin` (public, PKCE), and
  `nearsip-admin` (confidential, for Supabase Auth). Only `central-admin` is
  wired up so far; the others are ready for rollout steps 3–5.
- **Client roles per app,** emitted in each app's tokens as a `roles` claim that
  contains only that app's roles.
- **Groups:** `slc-super-admins` (super admin in every app) and `slc-support`
  (support/viewer everywhere).
- **Security:** TOTP enrolment required for every new user, 12+ character
  passwords, brute-force lockout, 30-minute idle / 10-hour max sessions,
  5-minute access tokens, login + admin events kept 90 days.

## Granting access

- Give someone Central Admin access: add a `central-admin` client role
  (`SUPER_ADMIN`, `APP_ADMIN`, `CONTENT_ADMIN`, `SUPPORT_ADMIN`, `REPORT_VIEWER`)
  or put them in a group. Their Central Admin roles are replaced by Keycloak's on
  every sign-in.
- Remove access: remove the role (takes effect at next sign-in), or disable the
  user and use **Sign out** on their sessions so open sessions end immediately
  through back-channel logout.

## Production checklist

This compose file and realm export are for development. Before production:

- [ ] Run Keycloak with `start` (not `start-dev`) behind HTTPS on its own domain,
      e.g. `https://id.slcvet.com`, with a managed PostgreSQL database.
- [ ] Remove the `users` block from the realm file, regenerate the
      `central-admin` and `nearsip-admin` client secrets, and store them in the
      secret manager.
- [ ] Replace every `localhost` redirect URI, web origin and post-logout URI with
      the real app URLs, and the back-channel logout URL with the API's real URL.
- [ ] Change the bootstrap admin password and restrict the `master` realm
      console to the team that runs Keycloak.
- [ ] Configure SMTP so password-reset and verification emails work.
- [ ] Back up the Keycloak database.
