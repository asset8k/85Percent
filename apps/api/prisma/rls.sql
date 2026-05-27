-- ============================================================================
-- Headroom — Row Level Security policies
-- Apply to your Supabase project via the SQL editor:
--   Dashboard → SQL Editor → paste this file → Run
-- ============================================================================
-- All tables use the service-role key from the API server, which bypasses RLS.
-- These policies are defence-in-depth: they prevent any anon/user-key query
-- from reading or writing data belonging to a different club.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: resolve the calling auth user's club_id from the users table.
-- Returns TEXT because the Prisma schema uses TEXT primary keys (not UUID).
-- SECURITY DEFINER so it can read across RLS without recursion.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.current_club_id();

CREATE OR REPLACE FUNCTION public.current_club_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.users WHERE id = auth.uid()::text
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (idempotent — safe to re-run)
-- ---------------------------------------------------------------------------
ALTER TABLE public.clubs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_financials   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Drop existing policies before recreating (idempotent)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "clubs: own club only"            ON public.clubs;
DROP POLICY IF EXISTS "users: own club only"            ON public.users;
DROP POLICY IF EXISTS "financials: own club only"       ON public.club_financials;
DROP POLICY IF EXISTS "players: own club only"          ON public.players;
DROP POLICY IF EXISTS "contracts: own club only"        ON public.contracts;
DROP POLICY IF EXISTS "scenarios: own club only"        ON public.scenarios;
DROP POLICY IF EXISTS "scenario_actions: via scenario"  ON public.scenario_actions;
DROP POLICY IF EXISTS "audit_logs: own club only"       ON public.audit_logs;

-- (simulations table dropped in MVP 2.0 migration; no need to drop its policy)

-- ---------------------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------------------
CREATE POLICY "clubs: own club only"
  ON public.clubs
  FOR ALL
  USING  (id = public.current_club_id())
  WITH CHECK (id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE POLICY "users: own club only"
  ON public.users
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- club_financials
-- ---------------------------------------------------------------------------
CREATE POLICY "financials: own club only"
  ON public.club_financials
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
CREATE POLICY "players: own club only"
  ON public.players
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------
CREATE POLICY "contracts: own club only"
  ON public.contracts
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- scenarios
-- ---------------------------------------------------------------------------
CREATE POLICY "scenarios: own club only"
  ON public.scenarios
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- scenario_actions — no direct club_id; inherit isolation via scenarios FK
-- ---------------------------------------------------------------------------
CREATE POLICY "scenario_actions: via scenario"
  ON public.scenario_actions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.scenarios s
      WHERE s.id = scenario_actions.scenario_id
        AND s.club_id = public.current_club_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scenarios s
      WHERE s.id = scenario_actions.scenario_id
        AND s.club_id = public.current_club_id()
    )
  );

-- ---------------------------------------------------------------------------
-- audit_logs (append-only in practice, but scoped by club for reads)
-- ---------------------------------------------------------------------------
CREATE POLICY "audit_logs: own club only"
  ON public.audit_logs
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());
