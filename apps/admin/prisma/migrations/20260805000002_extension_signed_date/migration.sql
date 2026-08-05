-- Keep the accounting date for a scheduled player extension separately from
-- the date on which its new wage phase takes effect. Existing historical rows
-- retain their known phase start as the best available fallback.
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "extension_signed_date" TIMESTAMP(3);

UPDATE "contracts"
SET "extension_signed_date" = "start_date"
WHERE "phase_type" = 'EXTENSION'
  AND "extension_signed_date" IS NULL;
