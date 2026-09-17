-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION', 'MAINTENANCE', 'DEPRECATED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('API', 'FIREBASE_ADMIN', 'SUPABASE', 'REGISTRY_ONLY', 'PENDING', 'NONE');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_STARTED', 'PLANNED', 'CONFIGURED', 'TESTING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "application" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" TEXT,
    "frontendTechnology" TEXT,
    "backendTechnology" TEXT,
    "databaseTechnology" TEXT,
    "authenticationTechnology" TEXT,
    "repositoryUrl" TEXT,
    "productionUrl" TEXT,
    "stagingUrl" TEXT,
    "environment" "DeploymentEnvironment" NOT NULL DEFAULT 'UNKNOWN',
    "integrationType" "IntegrationType" NOT NULL DEFAULT 'NONE',
    "adapterType" TEXT,
    "integrationStatus" "IntegrationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "status" "AppStatus" NOT NULL DEFAULT 'UNKNOWN',
    "version" TEXT,
    "healthCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_slug_key" ON "application"("slug");

-- CreateIndex
CREATE INDEX "application_status_idx" ON "application"("status");

-- CreateIndex
CREATE INDEX "application_integrationType_idx" ON "application"("integrationType");

-- CreateIndex
CREATE INDEX "application_integrationStatus_idx" ON "application"("integrationStatus");
