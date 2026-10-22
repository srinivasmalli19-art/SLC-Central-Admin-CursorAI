-- Central SSO (Keycloak / OIDC) support.

-- SSO-only administrators have no local password.
ALTER TABLE "admin_user" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Link to the account in the central identity provider.
ALTER TABLE "admin_user" ADD COLUMN "oidcSubject" TEXT;
CREATE UNIQUE INDEX "admin_user_oidcSubject_key" ON "admin_user"("oidcSubject");

-- IdP session id + logout hint for SSO sessions.
ALTER TABLE "admin_session" ADD COLUMN "oidcSid" TEXT;
ALTER TABLE "admin_session" ADD COLUMN "idTokenHint" TEXT;
CREATE INDEX "admin_session_oidcSid_idx" ON "admin_session"("oidcSid");
