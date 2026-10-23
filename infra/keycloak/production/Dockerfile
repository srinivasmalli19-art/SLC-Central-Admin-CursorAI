# SLC central login (Keycloak) — production image.
#
# - Pinned to the exact version the live checks ran against (26.4.0).
# - "Optimized" build: database and features fixed at build time, faster and
#   safer start-up (no build at runtime).
# - Imports the production realm (no test accounts, no secrets; values come
#   from environment placeholders) on first start only. Later restarts keep
#   whatever is in the database.
# - Runs behind a TLS-terminating proxy (Render, Cloudflare): plain HTTP inside,
#   X-Forwarded-* headers trusted, public hostname from KC_HOSTNAME, or on
#   Render from the service's own address (see start.sh).

FROM quay.io/keycloak/keycloak:26.4.0 AS builder
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=false
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.4.0
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY realm-slc.prod.json /opt/keycloak/data/import/realm-slc.json
COPY start.sh /opt/keycloak/bin/slc-start.sh

# KC_CACHE=local: one instance (Render, or Cloud Run with max 1 instance), so
# no searching for other Keycloak nodes. Sign-in sessions are stored in the
# database, so they survive restarts and scale-to-zero.
ENV KC_HTTP_ENABLED=true \
    KC_CACHE=local \
    KC_HTTP_PORT=8080 \
    KC_PROXY_HEADERS=xforwarded \
    KC_LOG_LEVEL=info \
    JAVA_OPTS_KC_HEAP="-XX:MaxRAMPercentage=65 -XX:InitialRAMPercentage=50"

EXPOSE 8080
USER 1000
ENTRYPOINT ["/opt/keycloak/bin/slc-start.sh"]
