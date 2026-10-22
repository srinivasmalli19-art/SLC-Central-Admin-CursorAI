#!/usr/bin/env bash
# Puts SLC Central Admin and the central login (Keycloak) live on Google Cloud,
# region Mumbai (asia-south1).
#
# Run it in Google Cloud Shell, from the repository folder:
#     bash infra/gcp/deploy.sh
#
# What it creates (in its own Google Cloud project, labelled app=slc-central):
#   - Cloud SQL PostgreSQL 16 (smallest size, private address only, daily backups)
#     with two databases: keycloak and slc_central_admin
#   - Secret Manager entries for every password and key (generated here; never
#     printed except the first Super Admin's one-time password at the end)
#   - Two Cloud Run services that scale to zero when idle:
#       slc-keycloak       the central login with MFA
#       slc-central-admin  Central Admin (API + web app)
#
# Safe to run again: it reuses what already exists and deploys the latest code.
# Rough cost: about US$10-15 a month (mostly the database); Cloud Run is billed
# only while someone is using it.
set -euo pipefail

REGION="${SLC_REGION:-asia-south1}"
DB_INSTANCE=slc-db
AR_REPO=slc
KC_SERVICE=slc-keycloak
CA_SERVICE=slc-central-admin

# App addresses used in the login's redirect settings at its first start.
STOCK_URL="${SLC_STOCK_URL:-https://www.logitask.in}"
STOCK_API_URL="${SLC_STOCK_API_URL:-https://fieldops-backend.onrender.com}"
PASUNESTAM_URL="${SLC_PASUNESTAM_URL:-https://pasunestam.com}"
PASUMITHRA_ADMIN_URL="${SLC_PASUMITHRA_ADMIN_URL:-https://pasumithra-admin.slcvet.com}"
SLCVET_URL="${SLC_SLCVET_URL:-https://slcvet.com}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2
  printf 'Fix that, then run the same command again; finished steps are skipped.\n' >&2
  exit 1
}
exists() { "$@" >/dev/null 2>&1; }

# ------------------------------------------------------------------ checks
cd "$(dirname "$0")/../.."
[ -f infra/gcp/cloudbuild.yaml ] || fail "run this from the SLC-Central-Admin-CursorAI folder"
command -v gcloud >/dev/null || fail "gcloud is missing (use Google Cloud Shell: https://shell.cloud.google.com)"
ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "$ACCOUNT" ] || fail "not signed in to Google Cloud (run: gcloud auth login)"
say "Signed in as $ACCOUNT"

# ----------------------------------------------------------------- project
PROJECT="${1:-${SLC_PROJECT:-}}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(gcloud projects list --filter='labels.app=slc-central' --format='value(projectId)' --limit=1 2>/dev/null || true)"
fi
if [ -z "$PROJECT" ]; then
  PROJECT="slc-central-$(openssl rand -hex 3)"
  say "Creating the Google Cloud project $PROJECT"
  gcloud projects create "$PROJECT" --name="SLC Central Admin" --labels=app=slc-central
else
  say "Using the Google Cloud project $PROJECT"
fi
gcloud config set project "$PROJECT" >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

# ----------------------------------------------------------------- billing
BILLING="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' 2>/dev/null || true)"
if [ -z "$BILLING" ]; then
  mapfile -t ACCOUNTS < <(gcloud billing accounts list --filter='open=true' --format='value(name,displayName)')
  case "${#ACCOUNTS[@]}" in
    0)
      fail "this Google account has no billing account yet. Create one at
       https://console.cloud.google.com/billing (country India; pay by UPI AutoPay or card)"
      ;;
    1) CHOICE=0 ;;
    *)
      say "Which billing account should pay for this?"
      for i in "${!ACCOUNTS[@]}"; do note "$((i + 1))) ${ACCOUNTS[$i]}"; done
      read -r -p "    Number: " PICK
      [[ "$PICK" =~ ^[0-9]+$ ]] && [ "$PICK" -ge 1 ] && [ "$PICK" -le "${#ACCOUNTS[@]}" ] || fail "not a number from the list"
      CHOICE=$((PICK - 1))
      ;;
  esac
  BILLING_ID="${ACCOUNTS[$CHOICE]%%[[:space:]]*}"
  BILLING_ID="${BILLING_ID#billingAccounts/}"
  say "Linking billing account $BILLING_ID"
  gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ID" >/dev/null
fi

# -------------------------------------------------------------------- APIs
say "Turning on the Google Cloud services this needs (a minute or two)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com compute.googleapis.com \
  servicenetworking.googleapis.com iam.googleapis.com

# ----------------------------------------------------------------- secrets
secret_value() { gcloud secrets versions access latest --secret="$1" 2>/dev/null; }
# ensure_secret NAME VALUE: create once; later runs keep the existing value.
ensure_secret() {
  if ! exists gcloud secrets describe "$1"; then
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic --labels=app=slc-central >/dev/null
  fi
}
# put_secret NAME VALUE: create, or add a new version when the value changed.
put_secret() {
  if ! exists gcloud secrets describe "$1"; then
    ensure_secret "$1" "$2"
  elif [ "$(secret_value "$1")" != "$2" ]; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  fi
}

EMAIL="$(secret_value slc-first-admin-email || true)"
if [ -z "$EMAIL" ]; then
  say "Who is the first Super Admin?"
  read -r -p "    Your email address: " EMAIL
  EMAIL="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ "$EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] || fail "that does not look like an email address"
  ensure_secret slc-first-admin-email "$EMAIL"
fi
note "First Super Admin: $EMAIL"

say "Creating passwords and keys (kept in Secret Manager)"
ensure_secret slc-kc-db-password "$(openssl rand -hex 24)"
ensure_secret slc-ca-db-password "$(openssl rand -hex 24)"
ensure_secret slc-kc-secret-central-admin "$(openssl rand -hex 32)"
ensure_secret slc-kc-secret-central-admin-api "$(openssl rand -hex 32)"
ensure_secret slc-kc-secret-nearsip "$(openssl rand -hex 32)"
ensure_secret slc-kc-console-password "$(openssl rand -hex 16)"
ensure_secret slc-first-admin-temp-password "Slc-$(openssl rand -hex 8)"
ensure_secret slc-mfa-key "$(openssl rand -base64 32)"

# ------------------------------------------------------- service accounts
RUN_SA="slc-run@$PROJECT.iam.gserviceaccount.com"
BUILD_SA="slc-build@$PROJECT.iam.gserviceaccount.com"
NEW_SA=0
if ! exists gcloud iam service-accounts describe "$RUN_SA"; then
  gcloud iam service-accounts create slc-run --display-name="SLC services (Cloud Run)" >/dev/null
  NEW_SA=1
fi
if ! exists gcloud iam service-accounts describe "$BUILD_SA"; then
  gcloud iam service-accounts create slc-build --display-name="SLC image builds" >/dev/null
  NEW_SA=1
fi
grant() {
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$1" --role="$2" \
    --condition=None --quiet >/dev/null
}
grant "$RUN_SA" roles/secretmanager.secretAccessor
grant "$BUILD_SA" roles/artifactregistry.writer
grant "$BUILD_SA" roles/logging.logWriter
grant "$BUILD_SA" roles/storage.objectViewer
if [ "$NEW_SA" = 1 ]; then
  note "Waiting 30 seconds for the new permissions to take effect"
  sleep 30
fi

# ----------------------------------------------------------------- network
say "Setting up the private network to the database"
exists gcloud compute networks describe default || gcloud compute networks create default --subnet-mode=auto
exists gcloud compute addresses describe slc-google-services --global ||
  gcloud compute addresses create slc-google-services --global --purpose=VPC_PEERING \
    --prefix-length=20 --network=default
if ! gcloud services vpc-peerings list --network=default --format='value(peering)' 2>/dev/null | grep -q servicenetworking; then
  gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
    --ranges=slc-google-services --network=default
fi

# ---------------------------------------------------------------- database
if ! exists gcloud sql instances describe "$DB_INSTANCE"; then
  say "Creating the database server (about 10 minutes; this is the slow part)"
  gcloud sql instances create "$DB_INSTANCE" --database-version=POSTGRES_16 --edition=enterprise \
    --tier=db-f1-micro --region="$REGION" --network="projects/$PROJECT/global/networks/default" \
    --no-assign-ip --storage-type=SSD --storage-size=10 --storage-auto-increase \
    --backup-start-time=20:30 --availability-type=zonal --deletion-protection
else
  say "Database server $DB_INSTANCE already exists"
fi
DB_IP="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(ipAddresses[0].ipAddress)')"
[ -n "$DB_IP" ] || fail "the database server has no address yet; wait a minute and run again"

for db in keycloak slc_central_admin; do
  exists gcloud sql databases describe "$db" --instance="$DB_INSTANCE" ||
    gcloud sql databases create "$db" --instance="$DB_INSTANCE" >/dev/null
done
USERS="$(gcloud sql users list --instance="$DB_INSTANCE" --format='value(name)')"
sql_user() { # sql_user NAME PASSWORD_SECRET
  if grep -qx "$1" <<<"$USERS"; then
    gcloud sql users set-password "$1" --instance="$DB_INSTANCE" --password="$(secret_value "$2")" >/dev/null
  else
    gcloud sql users create "$1" --instance="$DB_INSTANCE" --password="$(secret_value "$2")" >/dev/null
  fi
}
sql_user keycloak slc-kc-db-password
sql_user slc_admin slc-ca-db-password
put_secret slc-ca-database-url \
  "postgresql://slc_admin:$(secret_value slc-ca-db-password)@$DB_IP:5432/slc_central_admin?schema=public"

# ------------------------------------------------------------------ images
exists gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" >/dev/null
TAG="$(git rev-parse --short HEAD 2>/dev/null || echo build)-$(date +%Y%m%d%H%M%S)"
say "Building the two apps (about 8 minutes)"
gcloud builds submit --config=infra/gcp/cloudbuild.yaml \
  --substitutions="_REGION=$REGION,_TAG=$TAG" \
  --service-account="projects/$PROJECT/serviceAccounts/$BUILD_SA" .
IMAGES="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO"

# --------------------------------------------------------------- services
# Cloud Run addresses are fixed by service name, project number and region.
KC_URL="https://$KC_SERVICE-$PROJECT_NUMBER.$REGION.run.app"
CA_URL="https://$CA_SERVICE-$PROJECT_NUMBER.$REGION.run.app"
RUN_FLAGS=(--region="$REGION" --service-account="$RUN_SA" --allow-unauthenticated --port=8080
  --execution-environment=gen2 --cpu-boost --timeout=300 --min-instances=0
  --network=default --subnet=default --vpc-egress=private-ranges-only --quiet)

say "Starting the central login ($KC_SERVICE)"
gcloud run deploy "$KC_SERVICE" --image="$IMAGES/keycloak:$TAG" "${RUN_FLAGS[@]}" \
  --cpu=2 --memory=2Gi --max-instances=1 \
  --set-env-vars="^@^KC_HOSTNAME=$KC_URL@KC_DB_URL_HOST=$DB_IP@KC_DB_URL_DATABASE=keycloak@KC_DB_USERNAME=keycloak@KC_BOOTSTRAP_ADMIN_USERNAME=slc-console-admin@FIRST_SUPER_ADMIN_EMAIL=$EMAIL@CENTRAL_ADMIN_URL=$CA_URL@CENTRAL_ADMIN_API_URL=$CA_URL@STOCK_URL=$STOCK_URL@STOCK_API_URL=$STOCK_API_URL@PASUNESTAM_URL=$PASUNESTAM_URL@PASUMITHRA_ADMIN_URL=$PASUMITHRA_ADMIN_URL@SLCVET_URL=$SLCVET_URL" \
  --set-secrets="KC_DB_PASSWORD=slc-kc-db-password:latest,KC_BOOTSTRAP_ADMIN_PASSWORD=slc-kc-console-password:latest,FIRST_SUPER_ADMIN_TEMP_PASSWORD=slc-first-admin-temp-password:latest,KC_SECRET_CENTRAL_ADMIN=slc-kc-secret-central-admin:latest,KC_SECRET_CENTRAL_ADMIN_API=slc-kc-secret-central-admin-api:latest,KC_SECRET_NEARSIP=slc-kc-secret-nearsip:latest"

say "Starting Central Admin ($CA_SERVICE)"
gcloud run deploy "$CA_SERVICE" --image="$IMAGES/central-admin:$TAG" "${RUN_FLAGS[@]}" \
  --cpu=1 --memory=1Gi --max-instances=2 \
  --set-env-vars="^@^WEB_BASE_URL=$CA_URL@API_BASE_URL=$CA_URL@COOKIE_SECURE=true@OIDC_ISSUER_URL=$KC_URL/realms/slc@OIDC_CLIENT_ID=central-admin@KEYCLOAK_ADMIN_CLIENT_ID=central-admin-api@KEYCLOAK_SEND_INVITE_EMAIL=false@PASSWORD_LOGIN_ENABLED=false@IDP_TIMEOUT_SECONDS=90" \
  --set-secrets="DATABASE_URL=slc-ca-database-url:latest,OIDC_CLIENT_SECRET=slc-kc-secret-central-admin:latest,KEYCLOAK_ADMIN_CLIENT_SECRET=slc-kc-secret-central-admin-api:latest,MFA_ENCRYPTION_KEY=slc-mfa-key:latest"

# ------------------------------------------------------------------ checks
say "Checking that everything answers"
wait_for() { # wait_for URL WHAT
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 60 "$1"; then note "OK  $2"; return 0; fi
    sleep 10
  done
  fail "$2 did not answer at $1 (see Cloud Run logs in the Google Cloud console)"
}
wait_for "$KC_URL/realms/slc/.well-known/openid-configuration" "central login"
wait_for "$CA_URL/api/v1/health" "Central Admin"
wait_for "$CA_URL/" "Central Admin web page"
NEXT="$(curl -sS -o /dev/null --max-time 120 -w '%{redirect_url}' "$CA_URL/api/v1/auth/oidc/login")"
case "$NEXT" in
  "$KC_URL"/*) note "OK  Sign in with SLC Account hands over to the central login" ;;
  *) fail "Sign in with SLC Account did not hand over to $KC_URL (got: ${NEXT:-nothing})" ;;
esac
curl -fsS -o /dev/null --max-time 120 "$NEXT" || fail "the central login page did not open"
note "OK  The central login page opens"

# ------------------------------------------------------------------- done
cat <<EOF

=====================================================================
  SLC Central Admin is live.

  Open:      $CA_URL
  Press:     Sign in with SLC Account
  Email:     $EMAIL
  One-time password (first sign-in only): $(secret_value slc-first-admin-temp-password)

  You will choose your own password and add your authenticator app.
  After a quiet period the first page can take up to a minute to wake.

  Keycloak console (to set temporary passwords for people you invite):
    $KC_URL/admin   user: slc-console-admin
    password: gcloud secrets versions access latest --secret=slc-kc-console-password
=====================================================================
EOF
