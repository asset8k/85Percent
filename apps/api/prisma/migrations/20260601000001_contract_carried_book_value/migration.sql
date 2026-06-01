-- Carried Book Value override for contract phases. When a player signed an
-- extension mid-tenure and we lack the historical phases to amortise the
-- original fee (e.g. Transfermarkt snapshots only expose joined / last_extension
-- / contract_end), the CFO can record the exact remaining Net Book Value at the
-- moment of the extension. When non-null the SCR engine ignores transfer_fee and
-- amortises this value over the phase length, capped at 5 years. Nullable: a
-- null value means standard transfer-fee amortisation (the default).
ALTER TABLE "contracts" ADD COLUMN "carried_book_value" BIGINT;

-- Template ingestion marks rows whose contract_start was taken from a
-- last_extension date (an existing extension block). On hydration these become
-- EXTENSION-phase contracts so the UI auto-reveals the Carried Book Value field
-- and prompts the CFO to audit it (the original transfer fee is unknown).
ALTER TABLE "template_roster_items"
  ADD COLUMN "contract_start_from_extension" BOOLEAN NOT NULL DEFAULT false;
