#!/bin/bash
# Starts Keycloak with its public address. On Render, the service's own
# address is known at runtime (RENDER_EXTERNAL_URL, e.g.
# https://slcvet-id.onrender.com); KC_HOSTNAME, when set (e.g. after adding
# id.slcvet.com), takes precedence.
set -euo pipefail
if [ -z "${KC_HOSTNAME:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export KC_HOSTNAME="$RENDER_EXTERNAL_URL"
fi
if [ -z "${KC_HOSTNAME:-}" ]; then
  echo "KC_HOSTNAME is not set (and RENDER_EXTERNAL_URL is not available)" >&2
  exit 1
fi
exec /opt/keycloak/bin/kc.sh start --optimized --import-realm "$@"
