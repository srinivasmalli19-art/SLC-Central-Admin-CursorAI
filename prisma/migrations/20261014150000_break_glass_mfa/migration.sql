-- Authenticator codes for break-glass password sign-in.
ALTER TABLE "admin_user" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "admin_user" ADD COLUMN "mfaLastUsedStep" INTEGER;
