-- Granular permissions (MVP 2.1) — replace the single `role` enum on users and
-- invites with explicit boolean grants + an optional free-text job title.
--
-- Additive + backfill + drop, written idempotently so it is safe to run against
-- the live Supabase database more than once. NOT auto-applied by the runtime
-- (the app uses the Supabase client at runtime, Prisma only for schema).

-- ── users ──────────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_edit_roster"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_edit_scenarios" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_workspace_admin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the legacy role, if the column is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    UPDATE "users" SET
      "is_workspace_admin" = ("role" IN ('cfo', 'admin')),
      "can_edit_roster"    = ("role" IN ('cfo', 'admin', 'finance_analyst')),
      -- Every legacy role could edit scenarios (mutateScenarios was open to all
      -- authenticated members), so preserve that on migration.
      "can_edit_scenarios" = ("role" IS NOT NULL),
      "title" = COALESCE("title", CASE "role"
        WHEN 'cfo' THEN 'CFO'
        WHEN 'sporting_director' THEN 'Sporting Director'
        WHEN 'finance_analyst' THEN 'Finance Analyst'
        WHEN 'admin' THEN 'Admin'
        ELSE NULL END);
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN IF EXISTS "role";

-- ── invites ────────────────────────────────────────────────────────────────
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "can_edit_roster"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "can_edit_scenarios" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "is_workspace_admin" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invites' AND column_name = 'role'
  ) THEN
    UPDATE "invites" SET
      "is_workspace_admin" = ("role" IN ('cfo', 'admin')),
      "can_edit_roster"    = ("role" IN ('cfo', 'admin', 'finance_analyst')),
      "can_edit_scenarios" = ("role" IS NOT NULL),
      "title" = COALESCE("title", CASE "role"
        WHEN 'cfo' THEN 'CFO'
        WHEN 'sporting_director' THEN 'Sporting Director'
        WHEN 'finance_analyst' THEN 'Finance Analyst'
        WHEN 'admin' THEN 'Admin'
        ELSE NULL END);
  END IF;
END $$;

ALTER TABLE "invites" DROP COLUMN IF EXISTS "role";
