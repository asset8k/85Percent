-- ============================================================================
-- MVP 2.0 Phase 4 — Premier League SSR tables
-- Apply via Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ssr_working_capital — one row per club/season/month
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ssr_working_capital" (
    "id"                 TEXT         NOT NULL,
    "club_id"            TEXT         NOT NULL,
    "season"             TEXT         NOT NULL,
    "year_month"         TEXT         NOT NULL,
    "adjusted_cashflow"  BIGINT       NOT NULL,
    "qualifying_funds"   BIGINT       NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_working_capital_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ssr_working_capital_club_id_season_year_month_key"
  ON "ssr_working_capital"("club_id", "season", "year_month");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ssr_working_capital_club_id_fkey') THEN
    ALTER TABLE "ssr_working_capital"
      ADD CONSTRAINT "ssr_working_capital_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ssr_liquidity — one row per club/season
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ssr_liquidity" (
    "id"                  TEXT         NOT NULL,
    "club_id"             TEXT         NOT NULL,
    "season"              TEXT         NOT NULL,
    "liquid_assets"       BIGINT       NOT NULL,
    "liquid_liabilities"  BIGINT       NOT NULL,
    "squad_market_value"  BIGINT       NOT NULL,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_liquidity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ssr_liquidity_club_id_season_key"
  ON "ssr_liquidity"("club_id", "season");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ssr_liquidity_club_id_fkey') THEN
    ALTER TABLE "ssr_liquidity"
      ADD CONSTRAINT "ssr_liquidity_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ssr_equity — one row per club/season
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ssr_equity" (
    "id"                 TEXT         NOT NULL,
    "club_id"            TEXT         NOT NULL,
    "season"             TEXT         NOT NULL,
    "total_liabilities"  BIGINT       NOT NULL,
    "adjusted_assets"    BIGINT       NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssr_equity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ssr_equity_club_id_season_key"
  ON "ssr_equity"("club_id", "season");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ssr_equity_club_id_fkey') THEN
    ALTER TABLE "ssr_equity"
      ADD CONSTRAINT "ssr_equity_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
