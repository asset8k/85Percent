-- App-level TOTP (Authenticator App) + self-service password recovery.
-- The password itself lives in Supabase auth.users; these columns only gate
-- login (TOTP) and authorise resets (token + expiry).
ALTER TABLE "users" ADD COLUMN "totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "is_totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "password_reset_token" TEXT;
ALTER TABLE "users" ADD COLUMN "password_reset_expires" TIMESTAMP(3);

-- A reset token must be unique while live; partial index keeps NULLs unconstrained.
CREATE UNIQUE INDEX "users_password_reset_token_key" ON "users" ("password_reset_token") WHERE "password_reset_token" IS NOT NULL;
