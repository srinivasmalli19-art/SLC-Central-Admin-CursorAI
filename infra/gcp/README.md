# SLC Central Admin on Google Cloud (Mumbai)

**Decision (22 Oct 2026):** Central Admin and the central login (Keycloak) run on
Google Cloud in Mumbai (`asia-south1`). Google Cloud bills in rupees and can
take payment automatically by UPI AutoPay, which Render could not (RBI rules
meant paying every Render invoice by hand). The SLC apps already use Google
through Firebase.

| Piece | Google Cloud product | Size | Cost |
| --- | --- | --- | --- |
| Central login (`slc-keycloak`) | Cloud Run | 2 vCPU, 2 GB, scales to zero, 1 instance at most | Only while in use |
| Central Admin (`slc-central-admin`) | Cloud Run | 1 vCPU, 1 GB, scales to zero | Only while in use |
| Databases `keycloak` + `slc_central_admin` | Cloud SQL PostgreSQL 16, `db-f1-micro`, private address only, daily backups | smallest | About US$10 a month |
| Passwords and keys | Secret Manager | | A few cents |

Addresses (fixed by Google from the project number):
`https://slc-central-admin-<project number>.asia-south1.run.app` and
`https://slc-keycloak-<project number>.asia-south1.run.app`.

Because both services sleep when nobody uses them, the first page after a quiet
period takes about 15–30 seconds to wake the central login (the login page
wakes it as soon as it opens). To keep it always awake, set **Minimum
instances = 1** on `slc-keycloak` in the Cloud Run console (about US$20 a month
more).

## Deploy (or update)

1. Open https://console.cloud.google.com with the Google account that owns the
   SLC Firebase projects. If you have no billing account yet: **Billing** →
   **Create account** → India → UPI AutoPay or card.
2. Press the **Cloud Shell** button (`>_`, top right). In the terminal that
   opens, paste:

   ```
   git clone https://github.com/srinivasmalli19-art/SLC-Central-Admin-CursorAI.git && cd SLC-Central-Admin-CursorAI && bash infra/gcp/deploy.sh
   ```

3. Answer its questions: allow Cloud Shell to use your account, pick the billing
   account if you have several, and type your email (the first Super Admin).
4. Wait about 25 minutes. The script checks that the login, Central Admin and
   the hand-over between them all work, then prints the address and your
   one-time password.

Run the same script again at any time to deploy the latest code; it reuses the
project, database and passwords.

## What the script does

`deploy.sh` creates a project labelled `app=slc-central`, links billing, turns
on the needed APIs, generates every secret into Secret Manager, creates the
private network link and the Cloud SQL server, builds both images with Cloud
Build (`cloudbuild.yaml`), deploys both Cloud Run services and checks them.
The Keycloak image is `infra/keycloak/production/Dockerfile` (same as before);
Central Admin is `central-admin.Dockerfile`, which runs database migrations and
the seed at start-up (`start-central-admin.sh`).

## After the first sign-in

- **Invite people** in Central Admin → Admin access. Invitation emails are off
  until an email service is set up, so set each person's temporary password in
  the Keycloak console (`<login address>/admin`, user `slc-console-admin`,
  password: `gcloud secrets versions access latest --secret=slc-kc-console-password`
  in Cloud Shell) → realm `slc` → Users → person → Credentials → Set password.
- **Own domain** (`admin.slcvet.com`, `id.slcvet.com`): run
  `bash infra/gcp/add-domain.sh` in Cloud Shell. Cloud Run in Mumbai cannot map
  a domain directly, so the script sets up Google's recommended global HTTPS
  load balancer with a free Google-managed certificate (about US$18 a month).
  It prints two `A` records to add where slcvet.com's DNS is managed; run it
  again after adding them and, once the certificate is active (15–60 minutes),
  it adds the new address to the login's `central-admin` client, switches both
  services to the new names, remembers them for later `deploy.sh` runs, and
  checks the hand-over. The main slcvet.com site is not touched.
- **Backup (break-glass) password sign-in** is off. It can be enabled later
  with a Cloud Run job that runs `bootstrap:admin` and `mfa:enroll`.
