#!/bin/sh
# Start-up for Central Admin on Cloud Run: bring the database up to date
# (both steps are safe to repeat), then start the server.
set -e
npx prisma migrate deploy
npx tsx prisma/seed.ts
exec node apps/api/dist/index.js
