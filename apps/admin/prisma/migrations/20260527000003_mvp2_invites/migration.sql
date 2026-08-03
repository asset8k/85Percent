-- ============================================================================
-- MVP 2.0 Phase 5 — Invites table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "invites" (
    "id"          TEXT         NOT NULL,
    "club_id"     TEXT         NOT NULL,
    "email"       TEXT         NOT NULL,
    "role"        TEXT         NOT NULL,
    "invited_by"  TEXT         NOT NULL,
    "token"       TEXT         NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invites_token_key" ON "invites"("token");
CREATE INDEX IF NOT EXISTS "invites_email_accepted_at_idx" ON "invites"("email", "accepted_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_club_id_fkey') THEN
    ALTER TABLE "invites"
      ADD CONSTRAINT "invites_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
