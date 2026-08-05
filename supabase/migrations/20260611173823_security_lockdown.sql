-- ============================================================================
-- 85Percent — SECURITY LOCKDOWN (Row Level Security)
-- ----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL Editor and Run it against the
-- PRODUCTION (eu-central-1) project. It is idempotent — safe to run repeatedly.
--
-- WHY THIS MATTERS
--   The browser SPA (apps/web) ships the Supabase ANON key. That key, with the
--   project URL, exposes Supabase's auto-generated REST API at
--       https://<ref>.supabase.co/rest/v1/<table>
--   to anyone on the internet. RLS is the ONLY thing standing between that key
--   and every row in every table. With RLS off, a table is world-readable.
--
-- HOW THE APP STILL WORKS AFTER THIS
--   The API Route Handlers (apps/admin) connects as the `postgres` role and/or with the
--   service-role key. Both BYPASS RLS (service_role has BYPASSRLS; the table
--   owner is exempt under ENABLE — not FORCE). So the trusted server keeps full
--   access and does its own tenant checks; these policies only fence off the
--   public anon/authenticated key surface. DO NOT add FORCE ROW LEVEL SECURITY
--   to the tenant tables — it would filter the API's owner connection by a NULL
--   club_id and break every read.
--
-- TENANCY MODEL
--   The tenant is the CLUB, not the individual user. A user row carries club_id;
--   current_club_id() resolves the caller's club from their auth.uid(). Every
--   tenant table is fenced to "your club only".
--
-- This mirrors apps/admin/prisma/rls.sql + the demo_requests migration, gathered
-- into one paste-and-run file for the production cutover.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: resolve the calling auth user's club_id from public.users.
-- SECURITY DEFINER so it can read users without recursing into users' own RLS.
-- Returns TEXT (Prisma uses TEXT primary keys, not UUID).
-- ---------------------------------------------------------------------------
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
-- Enable RLS on every public table (idempotent). ENABLE only — never FORCE on
-- the tenant tables (see header).
-- ---------------------------------------------------------------------------
ALTER TABLE public.clubs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_financials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.managers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_working_capital ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_liquidity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssr_equity          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_clubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_roster_items ENABLE ROW LEVEL SECURITY;
-- _prisma_migrations only exists when the schema was provisioned via Prisma
-- (dev). On a DB bootstrapped from these Supabase migrations (prod) it is
-- absent, so guard it — keeps this migration portable to either provisioning path.
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop existing policies before recreating (idempotent)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "clubs: own club only"               ON public.clubs;
DROP POLICY IF EXISTS "users: own club only"               ON public.users;
DROP POLICY IF EXISTS "financials: own club only"          ON public.club_financials;
DROP POLICY IF EXISTS "players: own club only"             ON public.players;
DROP POLICY IF EXISTS "contracts: own club only"           ON public.contracts;
DROP POLICY IF EXISTS "managers: own club only"            ON public.managers;
DROP POLICY IF EXISTS "manager_contracts: own club only"   ON public.manager_contracts;
DROP POLICY IF EXISTS "scenarios: own club only"           ON public.scenarios;
DROP POLICY IF EXISTS "scenario_actions: via scenario"     ON public.scenario_actions;
DROP POLICY IF EXISTS "ssr_working_capital: own club only" ON public.ssr_working_capital;
DROP POLICY IF EXISTS "ssr_liquidity: own club only"       ON public.ssr_liquidity;
DROP POLICY IF EXISTS "ssr_equity: own club only"          ON public.ssr_equity;
DROP POLICY IF EXISTS "invites: own club only"             ON public.invites;
DROP POLICY IF EXISTS "notifications: own club only"       ON public.notifications;
DROP POLICY IF EXISTS "audit_logs: own club only"          ON public.audit_logs;

-- ---------------------------------------------------------------------------
-- Tenant tables — "your club only" for SELECT / INSERT / UPDATE / DELETE.
-- USING governs which rows are visible/affectable; WITH CHECK governs which
-- rows may be written, so a user can neither read nor plant another club's row.
-- ---------------------------------------------------------------------------
CREATE POLICY "clubs: own club only" ON public.clubs
  FOR ALL USING (id = public.current_club_id())
          WITH CHECK (id = public.current_club_id());

CREATE POLICY "users: own club only" ON public.users
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "financials: own club only" ON public.club_financials
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "players: own club only" ON public.players
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "contracts: own club only" ON public.contracts
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "managers: own club only" ON public.managers
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "manager_contracts: own club only" ON public.manager_contracts
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "scenarios: own club only" ON public.scenarios
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

-- scenario_actions has no club_id; inherit isolation through its scenario FK.
CREATE POLICY "scenario_actions: via scenario" ON public.scenario_actions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.scenarios s
    WHERE s.id = scenario_actions.scenario_id
      AND s.club_id = public.current_club_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.scenarios s
    WHERE s.id = scenario_actions.scenario_id
      AND s.club_id = public.current_club_id()));

CREATE POLICY "ssr_working_capital: own club only" ON public.ssr_working_capital
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "ssr_liquidity: own club only" ON public.ssr_liquidity
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "ssr_equity: own club only" ON public.ssr_equity
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "invites: own club only" ON public.invites
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "notifications: own club only" ON public.notifications
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

CREATE POLICY "audit_logs: own club only" ON public.audit_logs
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

-- ---------------------------------------------------------------------------
-- Service-role-only tables: RLS ON, NO policy. RLS-on + no permissive policy =
-- default-deny for every non-BYPASSRLS role, while the service role (and the
-- owner connection) still read/write freely. These hold no tenant-scoped data.
--   template_clubs / template_roster_items : club-agnostic seed dictionary
--   _prisma_migrations                     : Prisma's migration bookkeeping
-- (left intentionally policy-less above)
-- ---------------------------------------------------------------------------

-- ============================================================================
-- RAG / AI Co-pilot + admin/reference tables. These are created by raw SQL
-- (apps/admin/prisma/rag.sql etc.), NOT prisma/schema.prisma, so they sit outside
-- the tenant policy set above. Posture mirrors dev exactly.
-- ============================================================================
ALTER TABLE public.chat_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_table_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_sessions: own club only"     ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_messages: via session club"  ON public.chat_messages;

-- chat_sessions — tenant-scoped by club.
CREATE POLICY "chat_sessions: own club only" ON public.chat_sessions
  FOR ALL USING (club_id = public.current_club_id())
          WITH CHECK (club_id = public.current_club_id());

-- chat_messages — no club_id of their own; inherit isolation through the
-- owning chat_session's club.
CREATE POLICY "chat_messages: via session club" ON public.chat_messages
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.club_id = public.current_club_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.club_id = public.current_club_id()));

-- documents (RAG knowledge base) and league_table_snapshots (league reference
-- cache) are service-role-only:
-- RLS ON with NO policy → default-deny to anon/authenticated.

-- ============================================================================
-- demo_requests — the public lead form (apps/landing-page) writes here with the
-- ANON key. anon may INSERT and nothing else; reads/triage happen with the
-- service-role key. Belt-and-braces: RLS policy layer AND grant layer agree.
-- ============================================================================
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
-- FORCE is safe here: demo_requests is never read over the owner connection,
-- only via service_role (which bypasses FORCE too) or anon INSERT.
ALTER TABLE public.demo_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_requests: anon insert only" ON public.demo_requests;
CREATE POLICY "demo_requests: anon insert only" ON public.demo_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
-- Deliberately NO SELECT / UPDATE / DELETE policy → those default-deny.

REVOKE ALL    ON TABLE public.demo_requests FROM PUBLIC;
REVOKE ALL    ON TABLE public.demo_requests FROM anon, authenticated;
GRANT  INSERT ON TABLE public.demo_requests TO   anon, authenticated;

-- ============================================================================
-- POST-RUN AUDIT — run these two SELECTs after applying. BOTH should return
-- ZERO rows. They are the proof that the anon/authenticated key has no read
-- path into any tenant table.
-- ============================================================================

-- (1) Any public table that anon can SELECT *and* has RLS disabled = exposed.
--     demo_requests is excluded (anon is intentionally INSERT-only there).
--
--   SELECT t.relname AS exposed_table
--   FROM pg_class t
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--   WHERE n.nspname = 'public'
--     AND t.relkind = 'r'
--     AND t.relname <> 'demo_requests'
--     AND has_table_privilege('anon', t.oid, 'SELECT')
--     AND t.relrowsecurity = false
--   ORDER BY 1;

-- (2) Any public table with RLS still disabled at all (catch-all advisor check).
--
--   SELECT t.relname AS rls_disabled
--   FROM pg_class t
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--   WHERE n.nspname = 'public'
--     AND t.relkind = 'r'
--     AND t.relrowsecurity = false
--   ORDER BY 1;
