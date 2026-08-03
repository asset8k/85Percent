-- Enable Row Level Security on tables that shipped without it and tripped the
-- Supabase advisor ("RLS Disabled in Public", CRITICAL):
--   managers, manager_contracts        — tenant-scoped (club_id policies)
--   template_clubs, template_roster_items — service-role-only dictionary (no policy)
--   _prisma_migrations                 — Prisma internals (no policy)
--
-- The API uses the service-role key, which bypasses RLS, so these changes are
-- defence-in-depth against anon/user-key access — they don't affect the app.
-- current_club_id() is created by prisma/rls.sql (already present in the DB).

-- ── managers / manager_contracts (tenant-scoped) ────────────────────────────
ALTER TABLE "managers"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manager_contracts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers: own club only"           ON "managers";
DROP POLICY IF EXISTS "manager_contracts: own club only"  ON "manager_contracts";

CREATE POLICY "managers: own club only"
  ON "managers"
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "manager_contracts: own club only"
  ON "manager_contracts"
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ── template dictionary (service-role-only: RLS on, no policy) ───────────────
ALTER TABLE "template_clubs"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "template_roster_items" ENABLE ROW LEVEL SECURITY;

-- ── Prisma internals (no policy) ─────────────────────────────────────────────
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
