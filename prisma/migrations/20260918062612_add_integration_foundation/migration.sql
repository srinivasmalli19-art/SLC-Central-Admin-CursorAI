-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'TESTING', 'CONNECTED', 'DEGRADED', 'DISCONNECTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "CredentialProvider" AS ENUM ('ENV', 'SECRET_STORE', 'SECRETS_MANAGER', 'ENCRYPTED_DB');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'ROTATING', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "IntegrationEventType" AS ENUM ('CONFIG_UPDATED', 'INTEGRATION_ENABLED', 'INTEGRATION_DISABLED', 'CREDENTIAL_REFERENCE_UPDATED', 'CREDENTIAL_ACCESSED', 'CONNECTION_TEST_STARTED', 'CONNECTION_TEST_SUCCEEDED', 'CONNECTION_TEST_FAILED');

-- CreateTable
CREATE TABLE "application_integration" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL,
    "adapterType" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeoutMs" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_reference" (
    "id" TEXT NOT NULL,
    "applicationIntegrationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "CredentialProvider" NOT NULL DEFAULT 'ENV',
    "refKey" TEXT NOT NULL,
    "environment" "IntegrationEnvironment" NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "credential_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_event" (
    "id" TEXT NOT NULL,
    "applicationIntegrationId" TEXT NOT NULL,
    "type" "IntegrationEventType" NOT NULL,
    "correlationId" TEXT,
    "outcome" TEXT,
    "detail" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_integration_connectionStatus_idx" ON "application_integration"("connectionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "application_integration_applicationId_environment_key" ON "application_integration"("applicationId", "environment");

-- CreateIndex
CREATE INDEX "credential_reference_status_idx" ON "credential_reference"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credential_reference_applicationIntegrationId_name_key" ON "credential_reference"("applicationIntegrationId", "name");

-- CreateIndex
CREATE INDEX "integration_event_applicationIntegrationId_idx" ON "integration_event"("applicationIntegrationId");

-- AddForeignKey
ALTER TABLE "application_integration" ADD CONSTRAINT "application_integration_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_reference" ADD CONSTRAINT "credential_reference_applicationIntegrationId_fkey" FOREIGN KEY ("applicationIntegrationId") REFERENCES "application_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_event" ADD CONSTRAINT "integration_event_applicationIntegrationId_fkey" FOREIGN KEY ("applicationIntegrationId") REFERENCES "application_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
