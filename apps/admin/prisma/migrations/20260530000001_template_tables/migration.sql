-- Template roster dictionary (MVP 2.0 onboarding)
--
-- Static, club-agnostic tables populated by the monthly background sync worker
-- (apps/admin/backend/scripts/sync-templates.ts) from the felipeall/transfermarkt-api
-- scraper. Deliberately NOT RLS-isolated: the data is identical for every
-- tenant and is only read during onboarding to pre-fill a starting roster.

-- ── Enum domains ─────────────────────────────────────────────────────────────
CREATE TYPE "TemplateLeague"   AS ENUM ('PREMIER_LEAGUE', 'CHAMPIONSHIP');
CREATE TYPE "TemplatePosition" AS ENUM ('GK', 'DEF', 'MID', 'FWD');

-- ── template_clubs ───────────────────────────────────────────────────────────
CREATE TABLE "template_clubs" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "league"     "TemplateLeague" NOT NULL,
  "logo_url"   TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "template_clubs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "template_clubs_name_key" ON "template_clubs" ("name");

-- ── template_roster_items ────────────────────────────────────────────────────
CREATE TABLE "template_roster_items" (
  "id"                     TEXT NOT NULL,
  "template_club_id"       TEXT NOT NULL,
  "name"                   TEXT NOT NULL,
  "date_of_birth"          TIMESTAMP(3),
  "nationality"            TEXT,
  "position"               "TemplatePosition",
  "is_manager"             BOOLEAN NOT NULL DEFAULT false,
  "estimated_transfer_fee" BIGINT,
  "contract_start"         TIMESTAMP(3),
  "contract_end"           TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "template_roster_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_roster_items_template_club_id_idx"
  ON "template_roster_items" ("template_club_id");

ALTER TABLE "template_roster_items"
  ADD CONSTRAINT "template_roster_items_template_club_id_fkey"
  FOREIGN KEY ("template_club_id") REFERENCES "template_clubs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
