-- Per-app roles of each admin, synced from the SLC sign-in token.
ALTER TABLE "admin_user" ADD COLUMN "appRoles" JSONB NOT NULL DEFAULT '{}';
