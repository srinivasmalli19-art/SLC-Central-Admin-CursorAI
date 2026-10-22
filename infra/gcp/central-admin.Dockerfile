# SLC Central Admin: API + web app in one image (Google Cloud Run).
# Build from the repository root:
#   docker build -f infra/gcp/central-admin.Dockerfile .
FROM node:20-bookworm-slim

# Prisma needs OpenSSL at run time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first (cached between builds). Dev dependencies stay: the
# start script runs database migrations and the seed with them.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY prisma prisma
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production \
    WEB_DIST_DIR=apps/web/dist \
    PORT=8080
EXPOSE 8080
USER node
CMD ["sh", "infra/gcp/start-central-admin.sh"]
