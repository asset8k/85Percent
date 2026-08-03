-- ============================================================================
-- Currency architecture — workspace base currency on the Club
-- ============================================================================
-- Every club runs all of its financial data (input, storage, FFP engine) in a
-- single base currency. This adds the enum + the two columns that hold it:
--   base_currency      — the active currency (GBP default for existing clubs)
--   currency_is_custom — set once the CFO overrides the league-derived default,
--                        pinning it so league changes no longer re-derive it.
-- No data conversion: existing pence values keep their numeric value and are
-- simply re-labelled with the new symbol.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Currency') THEN
    CREATE TYPE "Currency" AS ENUM ('GBP', 'EUR', 'USD');
  END IF;
END $$;

ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "base_currency" "Currency" NOT NULL DEFAULT 'GBP';

ALTER TABLE "clubs"
  ADD COLUMN IF NOT EXISTS "currency_is_custom" BOOLEAN NOT NULL DEFAULT false;
