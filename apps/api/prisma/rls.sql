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
-- SECURITY DEFINER so it can read across RLS without recursion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_club_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.users WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (idempotent — safe to re-run)
-- ---------------------------------------------------------------------------
ALTER TABLE public.clubs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts       ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Drop existing policies before recreating (idempotent)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "clubs: own club only"           ON public.clubs;
DROP POLICY IF EXISTS "users: own club only"           ON public.users;
DROP POLICY IF EXISTS "financials: own club only"      ON public.club_financials;
DROP POLICY IF EXISTS "simulations: own club only"     ON public.simulations;
DROP POLICY IF EXISTS "audit_logs: own club only"      ON public.audit_logs;
DROP POLICY IF EXISTS "players: own club only"         ON public.players;
DROP POLICY IF EXISTS "contracts: own club only"       ON public.contracts;

-- ---------------------------------------------------------------------------
-- clubs
-- A user may only see/modify their own club row.
-- ---------------------------------------------------------------------------
CREATE POLICY "clubs: own club only"
  ON public.clubs
  FOR ALL
  USING  (id = public.current_club_id())
  WITH CHECK (id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- users
-- A user may only see/modify rows belonging to their own club.
-- (They can see team-mates in the same club, but not other clubs' users.)
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
-- simulations
-- ---------------------------------------------------------------------------
CREATE POLICY "simulations: own club only"
  ON public.simulations
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- audit_logs (append-only in practice, but scoped by club for reads)
-- ---------------------------------------------------------------------------
CREATE POLICY "audit_logs: own club only"
  ON public.audit_logs
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
