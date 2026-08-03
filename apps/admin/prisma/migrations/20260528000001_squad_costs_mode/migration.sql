-- Squad costs source mode
-- Adds an explicit "derived" vs "manual" toggle on club_financials so clubs can
-- override the roster-derived sum with a user-entered value. Default is
-- 'derived' to preserve existing MVP 2.0 behavior; manual_squad_costs is only
-- meaningful (and only read) when squad_costs_mode = 'manual'.

ALTER TABLE "club_financials"
  ADD COLUMN "squad_costs_mode" TEXT NOT NULL DEFAULT 'derived',
  ADD COLUMN "manual_squad_costs" BIGINT;

ALTER TABLE "club_financials"
  ADD CONSTRAINT "club_financials_squad_costs_mode_check"
  CHECK ("squad_costs_mode" IN ('derived', 'manual'));
