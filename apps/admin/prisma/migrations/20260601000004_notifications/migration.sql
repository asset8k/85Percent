-- ============================================================================
-- MVP 2.1 — In-app notifications
-- ============================================================================

-- Severity enum (INFO / WARNING / CRITICAL) drives the bell colour-coding.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
    CREATE TYPE "NotificationType" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notifications" (
    "id"         TEXT             NOT NULL,
    "club_id"    TEXT             NOT NULL,
    "user_id"    TEXT,
    "title"      TEXT             NOT NULL,
    "message"    TEXT             NOT NULL,
    "type"       "NotificationType" NOT NULL DEFAULT 'INFO',
    "is_read"    BOOLEAN          NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_club_id_created_at_idx" ON "notifications"("club_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_club_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
