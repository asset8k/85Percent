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
-- Idempotent: CREATE OR REPLACE works because the signature hasn't changed
-- since Phase 1 (RETURNS text). Don't DROP — policies depend on this function.
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
ALTER TABLE public.clubs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_financials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_working_capital ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_liquidity      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_equity         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         ENABLE ROW LEVEL SECURITY;

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
DROP POLICY IF EXISTS "ssr_working_capital: own club only" ON public.ssr_working_capital;
DROP POLICY IF EXISTS "ssr_liquidity: own club only"       ON public.ssr_liquidity;
DROP POLICY IF EXISTS "ssr_equity: own club only"          ON public.ssr_equity;
DROP POLICY IF EXISTS "invites: own club only"             ON public.invites;
DROP POLICY IF EXISTS "audit_logs: own club only"          ON public.audit_logs;

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
-- ssr_working_capital
-- ---------------------------------------------------------------------------
CREATE POLICY "ssr_working_capital: own club only"
  ON public.ssr_working_capital
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- ssr_liquidity
-- ---------------------------------------------------------------------------
CREATE POLICY "ssr_liquidity: own club only"
  ON public.ssr_liquidity
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- ssr_equity
-- ---------------------------------------------------------------------------
CREATE POLICY "ssr_equity: own club only"
  ON public.ssr_equity
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- invites
-- Note: the lookup-by-token endpoint runs as the service role (bypasses RLS)
-- because the invitee isn't authenticated yet. RLS still guards every other
-- entry path.
-- ---------------------------------------------------------------------------
CREATE POLICY "invites: own club only"
  ON public.invites
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

-- ============================================================================
-- Manager (Head Coach) tables + Template dictionary + Prisma internals
-- Added after the multi-phase ledger / Manager migration and the MVP 2.0
-- onboarding template tables, which shipped without RLS and tripped Supabase's
-- "RLS Disabled in Public" advisor (CRITICAL).
-- ============================================================================

-- ── managers / manager_contracts — tenant-scoped, same pattern as players ──
ALTER TABLE public.managers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers: own club only"          ON public.managers;
DROP POLICY IF EXISTS "manager_contracts: own club only" ON public.manager_contracts;

CREATE POLICY "managers: own club only"
  ON public.managers
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "manager_contracts: own club only"
  ON public.manager_contracts
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ── template_clubs / template_roster_items ─────────────────────────────────
-- These are a club-agnostic static dictionary read ONLY by the API (service
-- role, which bypasses RLS). No anon/authenticated client ever queries them
-- directly, so we enable RLS with NO policy: that denies all key-based access
-- while the service role still reads/writes freely. This silences the advisor
-- without inventing a tenant scope these rows don't have.
ALTER TABLE public.template_clubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_roster_items ENABLE ROW LEVEL SECURITY;

-- ── notifications — tenant-scoped, same pattern as players ─────────────────
-- Shipped in the MVP 2.1 in-app notifications migration without RLS, tripping
-- Supabase's "RLS Disabled in Public" advisor. Scoped by club_id (a null
-- user_id means a club-wide notification); the per-user fan-out is handled in
-- the API, which reads/writes as the service role and bypasses RLS anyway.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications: own club only" ON public.notifications;

CREATE POLICY "notifications: own club only"
  ON public.notifications
  FOR ALL
  USING  (club_id = public.current_club_id())
  WITH CHECK (club_id = public.current_club_id());

-- ── _prisma_migrations — Prisma's internal bookkeeping ─────────────────────
-- Only touched by the migration engine over the privileged direct connection
-- (table owner / postgres role, which bypasses RLS). Enable RLS with no policy
-- so it isn't exposed via the anon/auth PostgREST surface.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
