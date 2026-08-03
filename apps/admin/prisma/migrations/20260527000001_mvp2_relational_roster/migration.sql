-- ============================================================================
-- MVP 2.0 Migration — Relational Roster Schema
-- Apply via Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================
-- DESTRUCTIVE: drops simulations table and current_squad_costs column.
-- Back up before running in any environment with real data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. club_financials — drop manual aggregate, add season date bounds
-- ----------------------------------------------------------------------------
ALTER TABLE "club_financials" DROP COLUMN IF EXISTS "current_squad_costs";

ALTER TABLE "club_financials"
  ADD COLUMN IF NOT EXISTS "season_start_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "season_end_date"   TIMESTAMP(3);

-- ----------------------------------------------------------------------------
-- 2. players — add lifecycle columns and composite index
-- ----------------------------------------------------------------------------
ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "is_active"   BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "players_club_id_is_active_idx"
  ON "players"("club_id", "is_active");

-- ----------------------------------------------------------------------------
-- 3. contracts — rename date columns, add updated_at, add composite indexes
-- ----------------------------------------------------------------------------
-- Safe rename: no data loss, instant in Postgres
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'contract_start'
  ) THEN
    ALTER TABLE "contracts" RENAME COLUMN "contract_start" TO "start_date";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contracts' AND column_name = 'contract_end'
  ) THEN
    ALTER TABLE "contracts" RENAME COLUMN "contract_end" TO "end_date";
  END IF;
END $$;

ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "contracts_club_id_is_active_idx"
  ON "contracts"("club_id", "is_active");

CREATE INDEX IF NOT EXISTS "contracts_player_id_is_active_idx"
  ON "contracts"("player_id", "is_active");

-- ----------------------------------------------------------------------------
-- 4. Drop simulations — cascades FK references
-- MVP 1.0 simulation history is not migrated forward (destructive by design)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS "simulations" CASCADE;

-- ----------------------------------------------------------------------------
-- 5. Create scenarios (named multi-action plans, replaces simulations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "scenarios" (
    "id"          TEXT         NOT NULL,
    "club_id"     TEXT         NOT NULL,
    "created_by"  TEXT         NOT NULL,
    "season"      TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "is_included" BOOLEAN      NOT NULL DEFAULT false,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scenarios_club_id_season_idx"
  ON "scenarios"("club_id", "season");

ALTER TABLE "scenarios"
  ADD CONSTRAINT "scenarios_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scenarios"
  ADD CONSTRAINT "scenarios_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 6. Create scenario_actions (ordered actions within a scenario)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "scenario_actions" (
    "id"          TEXT         NOT NULL,
    "scenario_id" TEXT         NOT NULL,
    "action_type" TEXT         NOT NULL,  -- 'buy' | 'sell' | 'loan_in' | 'loan_out' | 'release'
    "payload"     JSONB        NOT NULL,
    "player_id"   TEXT,
    "order_index" INTEGER      NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scenario_actions_scenario_id_order_index_idx"
  ON "scenario_actions"("scenario_id", "order_index");

ALTER TABLE "scenario_actions"
  ADD CONSTRAINT "scenario_actions_scenario_id_fkey"
    FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scenario_actions"
  ADD CONSTRAINT "scenario_actions_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "players"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
