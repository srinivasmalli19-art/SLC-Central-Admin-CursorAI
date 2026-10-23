#!/usr/bin/env bash
# Puts SLC Central Admin and the central login on your own domain:
#     https://admin.slcvet.com   Central Admin
#     https://id.slcvet.com      central login
# (change with SLC_ADMIN_HOST / SLC_ID_HOST). The main slcvet.com site is not
# touched.
#
# Cloud Run in Mumbai cannot map a domain directly, so this uses Google's
# recommended way: one global HTTPS load balancer with a free Google-managed
# certificate. Extra cost: about US$18 a month.
#
# Run in Google Cloud Shell, from the repository folder, after deploy.sh:
#     bash infra/gcp/add-domain.sh
# First run: creates the load balancer and prints two DNS records to add at
# your domain provider. Run it again after adding them: once Google has issued
# the certificate (15-60 minutes after DNS is in place) it switches both apps to
# the new addresses and checks them.
set -euo pipefail

REGION="${SLC_REGION:-asia-south1}"
ADMIN_HOST="${SLC_ADMIN_HOST:-admin.slcvet.com}"
ID_HOST="${SLC_ID_HOST:-id.slcvet.com}"
KC_SERVICE=slc-keycloak
CA_SERVICE=slc-central-admin

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2
  printf 'Fix that, then run the same command again; finished steps are skipped.\n' >&2
  exit 1
}
exists() { "$@" >/dev/null 2>&1; }

cd "$(dirname "$0")/../.."
[ -f infra/gcp/deploy.sh ] || fail "run this from the SLC-Central-Admin-CursorAI folder"
PROJECT="${1:-${SLC_PROJECT:-}}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(gcloud projects list --filter='labels.app=slc-central' --format='value(projectId)' --limit=1 2>/dev/null || true)"
fi
[ -n "$PROJECT" ] || fail "no SLC project found; run infra/gcp/deploy.sh first"
gcloud config set project "$PROJECT" >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
KC_RUN_URL="https://$KC_SERVICE-$PROJECT_NUMBER.$REGION.run.app"
CA_RUN_URL="https://$CA_SERVICE-$PROJECT_NUMBER.$REGION.run.app"
say "Project $PROJECT: $ADMIN_HOST (Central Admin) and $ID_HOST (login)"
exists gcloud run services describe "$CA_SERVICE" --region="$REGION" || fail "Central Admin is not deployed yet; run infra/gcp/deploy.sh first"

# ----------------------------------------------------------- load balancer
say "Setting up the load balancer (skips parts that already exist)"
exists gcloud compute addresses describe slc-lb-ip --global ||
  gcloud compute addresses create slc-lb-ip --global --ip-version=IPV4
IP="$(gcloud compute addresses describe slc-lb-ip --global --format='value(address)')"

backend() { # backend NAME CLOUD_RUN_SERVICE
  exists gcloud compute network-endpoint-groups describe "slc-neg-$1" --region="$REGION" ||
    gcloud compute network-endpoint-groups create "slc-neg-$1" --region="$REGION" \
      --network-endpoint-type=serverless --cloud-run-service="$2"
  if ! exists gcloud compute backend-services describe "slc-be-$1" --global; then
    gcloud compute backend-services create "slc-be-$1" --global --load-balancing-scheme=EXTERNAL_MANAGED
    gcloud compute backend-services add-backend "slc-be-$1" --global \
      --network-endpoint-group="slc-neg-$1" --network-endpoint-group-region="$REGION"
  fi
}
backend admin "$CA_SERVICE"
backend login "$KC_SERVICE"

if ! exists gcloud compute url-maps describe slc-lb --global; then
  gcloud compute url-maps create slc-lb --global --default-service=slc-be-admin
  gcloud compute url-maps add-path-matcher slc-lb --global --path-matcher-name=login \
    --default-service=slc-be-login --new-hosts="$ID_HOST"
fi
exists gcloud compute ssl-certificates describe slc-cert --global ||
  gcloud compute ssl-certificates create slc-cert --global --domains="$ADMIN_HOST,$ID_HOST"
exists gcloud compute target-https-proxies describe slc-https --global ||
  gcloud compute target-https-proxies create slc-https --global --url-map=slc-lb --ssl-certificates=slc-cert
exists gcloud compute forwarding-rules describe slc-https --global ||
  gcloud compute forwarding-rules create slc-https --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --address=slc-lb-ip --target-https-proxy=slc-https --ports=443

# http:// sends people on to https://
if ! exists gcloud compute url-maps describe slc-http-redirect --global; then
  REDIRECT_FILE="$(mktemp)"
  cat >"$REDIRECT_FILE" <<'YAML'
name: slc-http-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
  gcloud compute url-maps import slc-http-redirect --global --source="$REDIRECT_FILE" --quiet
  rm -f "$REDIRECT_FILE"
fi
exists gcloud compute target-http-proxies describe slc-http --global ||
  gcloud compute target-http-proxies create slc-http --global --url-map=slc-http-redirect
exists gcloud compute forwarding-rules describe slc-http --global ||
  gcloud compute forwarding-rules create slc-http --global --load-balancing-scheme=EXTERNAL_MANAGED \
    --address=slc-lb-ip --target-http-proxy=slc-http --ports=80

# ------------------------------------------------------------- certificate
CERT_STATUS="$(gcloud compute ssl-certificates describe slc-cert --global --format='value(managed.status)')"
if [ "$CERT_STATUS" != "ACTIVE" ]; then
  cat <<EOF

=====================================================================
  Add these two DNS records at the company where slcvet.com's DNS is
  managed (where you bought it, or Cloudflare / Vercel if it was moved):

    Type   Name    Value
    A      admin   $IP
    A      id      $IP

  If there is a "Proxy" / orange-cloud switch (Cloudflare), turn it OFF
  for these two records ("DNS only").

  Then run this script again. Google issues the certificate 15-60
  minutes after the records are in place; until then this script stops
  here. Certificate status now: ${CERT_STATUS:-PROVISIONING}
=====================================================================
EOF
  gcloud compute ssl-certificates describe slc-cert --global \
    --format='table[box](managed.domainStatus:label="DOMAIN STATUS")' 2>/dev/null || true
  exit 0
fi
note "OK  Certificate for $ADMIN_HOST and $ID_HOST is active"

# ------------------------------------------------- switch to the new names
say "Teaching the central login about the new Central Admin address"
CONSOLE_PASSWORD="$(gcloud secrets versions access latest --secret=slc-kc-console-password)"
# Talk to the login on whichever address currently answers as its issuer.
KC_NOW="$KC_RUN_URL"
if curl -fsS --max-time 90 "https://$ID_HOST/realms/slc/.well-known/openid-configuration" 2>/dev/null |
  grep -q "\"issuer\":\"https://$ID_HOST/realms/slc\""; then
  KC_NOW="https://$ID_HOST"
fi
TOKEN="$(curl -fsS --max-time 120 -d grant_type=password -d client_id=admin-cli \
  -d username=slc-console-admin --data-urlencode "password=$CONSOLE_PASSWORD" \
  "$KC_NOW/realms/master/protocol/openid-connect/token" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')" ||
  fail "could not sign in to the login console as slc-console-admin"
CLIENT_JSON="$(curl -fsS -H "Authorization: Bearer $TOKEN" "$KC_NOW/admin/realms/slc/clients?clientId=central-admin")"
CLIENT_ID="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[0]["id"])' "$CLIENT_JSON")"
UPDATED="$(python3 - "$CLIENT_JSON" "$CA_RUN_URL" "https://$ADMIN_HOST" <<'PY'
import json, sys
client = json.loads(sys.argv[1])[0]
old, new = sys.argv[2].rstrip('/'), sys.argv[3].rstrip('/')
def with_new(urls):
    out = list(urls)
    for u in urls:
        if u.startswith(old):
            v = new + u[len(old):]
            if v not in out:
                out.append(v)
    return out
client['redirectUris'] = with_new(client.get('redirectUris', []))
client['webOrigins'] = with_new(client.get('webOrigins', []))
attrs = client.setdefault('attributes', {})
post = [u for u in attrs.get('post.logout.redirect.uris', '').split('##') if u]
attrs['post.logout.redirect.uris'] = '##'.join(with_new(post))
bc = attrs.get('backchannel.logout.url', '')
if bc.startswith(old):
    attrs['backchannel.logout.url'] = new + bc[len(old):]
print(json.dumps(client))
PY
)"
curl -fsS -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data "$UPDATED" "$KC_NOW/admin/realms/slc/clients/$CLIENT_ID" ||
  fail "could not update the central-admin settings in the login"
note "OK  central-admin accepts https://$ADMIN_HOST (the old address keeps working too)"

# Remember the names so later runs of deploy.sh keep them.
for pair in "slc-admin-host=$ADMIN_HOST" "slc-id-host=$ID_HOST"; do
  name="${pair%%=*}" value="${pair#*=}"
  if ! exists gcloud secrets describe "$name"; then
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic --labels=app=slc-central >/dev/null
  elif [ "$(gcloud secrets versions access latest --secret="$name")" != "$value" ]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  fi
done

say "Switching both apps to the new addresses"
gcloud run services update "$KC_SERVICE" --region="$REGION" --quiet \
  --update-env-vars="KC_HOSTNAME=https://$ID_HOST"
gcloud run services update "$CA_SERVICE" --region="$REGION" --quiet \
  --update-env-vars="WEB_BASE_URL=https://$ADMIN_HOST,API_BASE_URL=https://$ADMIN_HOST,OIDC_ISSUER_URL=https://$ID_HOST/realms/slc"

# ------------------------------------------------------------------ checks
say "Checking the new addresses"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 90 "https://$ID_HOST/realms/slc/.well-known/openid-configuration" |
    grep -q "\"issuer\":\"https://$ID_HOST/realms/slc\""; then
    note "OK  https://$ID_HOST answers as the central login"
    break
  fi
  sleep 15
done
curl -fsS -o /dev/null --max-time 90 "https://$ADMIN_HOST/api/v1/health" || fail "https://$ADMIN_HOST does not answer yet"
note "OK  https://$ADMIN_HOST answers"
NEXT="$(curl -sS -o /dev/null --max-time 120 -w '%{redirect_url}' "https://$ADMIN_HOST/api/v1/auth/oidc/login")"
case "$NEXT" in
  "https://$ID_HOST"/*) note "OK  Sign in with SLC Account hands over to https://$ID_HOST" ;;
  *) fail "sign-in did not hand over to https://$ID_HOST (got: ${NEXT:-nothing})" ;;
esac
curl -fsS -o /dev/null --max-time 120 "$NEXT" || fail "the login page on https://$ID_HOST did not open"
note "OK  The login page opens"

cat <<EOF

=====================================================================
  Done. Central Admin:  https://$ADMIN_HOST
        Login console:  https://$ID_HOST/admin
  The old *.run.app address still opens Central Admin.
=====================================================================
EOF
