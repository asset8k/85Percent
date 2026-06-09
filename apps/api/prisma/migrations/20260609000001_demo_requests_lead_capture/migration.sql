-- Landing-page lead capture — the public "Request Access / Demo" form.
--
-- This is the ONLY table the public marketing site (apps/landing-page) talks to,
-- and it does so with the Supabase ANON key. It is therefore the one place anon
-- is granted write access, and it is locked down hard on two reinforcing layers:
--
--   1. RLS (row layer): RLS is enabled and the ONLY policy is FOR INSERT. No
--      SELECT / UPDATE / DELETE policy exists, so Postgres default-denies those
--      for every non-bypassing role — the anon key can drop a lead in but can
--      never read it back, edit it, or delete it.
--   2. GRANT (privilege layer): privileges are revoked then narrowed so the
--      grant layer matches the policy layer — anon holds INSERT and nothing else.
--
-- Reading / triaging leads is done by the API or admin panel with the
-- service-role key, which has BYPASSRLS and ignores all of the above — the same
-- pattern every other table in this database uses.
--
-- The landing page never touches the core application tables: client-side it
-- only ever calls .insert() on demo_requests. The core tables keep RLS enabled
-- with no anon policy (see 20260530000002_rls_managers_and_templates), so even a
-- leaked/misused anon key cannot read club, roster, contract, or financial data.
-- An audit query to confirm no public table is exposed to anon sits at the foot
-- of this file.
--
-- Additive + idempotent — safe to run against the live Supabase DB more than
-- once. NOT auto-applied by the runtime (Prisma only models the schema; the
-- apps talk to Postgres via the Supabase client at runtime).

-- ── table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "demo_requests" (
  "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "full_name"  TEXT,
  "work_email" TEXT        NOT NULL,
  "club"       TEXT,
  "role"       TEXT,                       -- job title (CFO, Sporting Director, …)
  "message"    TEXT,
  "source"     TEXT,                       -- which CTA/section drove the submit
  "status"     TEXT        NOT NULL DEFAULT 'new',  -- triage state (service-role only)
  CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id"),
  -- anon can insert freely, so cap field sizes and sanity-check the email at the
  -- DB boundary to blunt obvious junk / oversized payloads (not a substitute for
  -- edge rate-limiting, which the landing page adds separately).
  CONSTRAINT "demo_requests_email_format" CHECK ("work_email" ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT "demo_requests_email_len"    CHECK (char_length("work_email") <= 254),
  CONSTRAINT "demo_requests_name_len"     CHECK ("full_name" IS NULL OR char_length("full_name") <= 120),
  CONSTRAINT "demo_requests_club_len"     CHECK ("club"      IS NULL OR char_length("club")      <= 160),
  CONSTRAINT "demo_requests_role_len"     CHECK ("role"      IS NULL OR char_length("role")      <= 120),
  CONSTRAINT "demo_requests_message_len"  CHECK ("message"   IS NULL OR char_length("message")   <= 2000),
  CONSTRAINT "demo_requests_source_len"   CHECK ("source"    IS NULL OR char_length("source")    <= 80)
);

-- service-role triage reads the queue newest-first
CREATE INDEX IF NOT EXISTS "demo_requests_created_at_idx" ON "demo_requests" ("created_at" DESC);

-- ── RLS layer ────────────────────────────────────────────────────────────────
ALTER TABLE "demo_requests" ENABLE ROW LEVEL SECURITY;
-- FORCE so even the table-owner role obeys RLS; service_role (BYPASSRLS) still
-- bypasses, which is how the API/admin read the leads.
ALTER TABLE "demo_requests" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_requests: anon insert only" ON "demo_requests";
CREATE POLICY "demo_requests: anon insert only"
  ON "demo_requests"
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Deliberately NO SELECT / UPDATE / DELETE policy. RLS-on + no permissive policy
-- = default deny for those commands for every non-BYPASSRLS role.

-- ── GRANT layer (defence in depth) ───────────────────────────────────────────
-- Supabase grants anon/authenticated broad table privileges by default; strip
-- them back so the privilege layer agrees with the policy layer: INSERT only.
REVOKE ALL ON TABLE "demo_requests" FROM PUBLIC;
REVOKE ALL ON TABLE "demo_requests" FROM anon, authenticated;
GRANT  INSERT ON TABLE "demo_requests" TO anon, authenticated;
-- service_role retains its implicit full access (and bypasses RLS regardless).

-- ── post-migration audit (run manually; should return ZERO rows) ─────────────
-- Confirms anon has no read path into any core table — i.e. no public table is
-- both granted SELECT to anon AND missing RLS. demo_requests is excluded since
-- anon is intentionally INSERT-only there.
--
--   SELECT t.relname AS exposed_table
--   FROM pg_class t
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--   WHERE n.nspname = 'public'
--     AND t.relkind = 'r'
--     AND has_table_privilege('anon', t.oid, 'SELECT')
--     AND t.relrowsecurity = false
--   ORDER BY 1;
