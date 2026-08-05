-- Keep the acquisition asset separate from contractual wage phases. This makes
-- future renewals schedulable without dropping historical amortisation.
CREATE TABLE IF NOT EXISTS "player_registration_assets" (
  "player_id" TEXT NOT NULL,
  "club_id" TEXT NOT NULL,
  "acquisition_fee" BIGINT NOT NULL DEFAULT 0,
  "acquisition_agent_fee" BIGINT NOT NULL DEFAULT 0,
  "acquisition_date" TIMESTAMP(3) NOT NULL,
  "carrying_value" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "player_registration_assets_pkey" PRIMARY KEY ("player_id"),
  CONSTRAINT "player_registration_assets_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "player_registration_assets_club_id_fkey"
    FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "player_registration_assets_club_id_idx"
  ON "player_registration_assets" ("club_id");

ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "amortisation_treatment" TEXT NOT NULL DEFAULT 'CONTINUE_CURRENT_SCHEDULE';

ALTER TABLE "contracts"
  DROP CONSTRAINT IF EXISTS "contracts_amortisation_treatment_check";
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_amortisation_treatment_check"
  CHECK ("amortisation_treatment" IN ('CONTINUE_CURRENT_SCHEDULE', 'SPREAD_REMAINING_BOOK_VALUE'));

CREATE INDEX IF NOT EXISTS "contracts_player_id_start_date_idx"
  ON "contracts" ("player_id", "start_date");

-- Backfill one durable asset per player from their earliest phase. An imported
-- carrying value remains authoritative only where there was no acquisition fee.
INSERT INTO "player_registration_assets" (
  "player_id", "club_id", "acquisition_fee", "acquisition_agent_fee",
  "acquisition_date", "carrying_value", "created_at", "updated_at"
)
SELECT DISTINCT ON (c."player_id")
  c."player_id",
  c."club_id",
  c."transfer_fee",
  c."agent_fee",
  c."start_date",
  CASE WHEN c."transfer_fee" = 0 THEN c."carried_book_value" ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "contracts" c
ORDER BY c."player_id", c."start_date" ASC, c."created_at" ASC
ON CONFLICT ("player_id") DO NOTHING;
