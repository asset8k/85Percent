-- Multi-phase contract ledger + Manager (Head Coach) entity
--
-- 1. Adds ledger columns to `contracts` (phase_type / is_current / superseded_at)
--    and backfills is_current from the existing is_active flag so current rows
--    stay live. A partial unique index guarantees one current phase per player.
-- 2. Adds `managers` and `manager_contracts` (a mirror of `contracts` whose
--    capitalised fee is a "compensation fee"), with the same ledger semantics.

-- ── contracts: ledger columns ──────────────────────────────────────────────
ALTER TABLE "contracts"
  ADD COLUMN "phase_type"    TEXT NOT NULL DEFAULT 'INITIAL',
  ADD COLUMN "is_current"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "superseded_at" TIMESTAMP(3);

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_phase_type_check"
  CHECK ("phase_type" IN ('INITIAL', 'EXTENSION'));

-- Existing rows: the live phase is whichever contract was active.
UPDATE "contracts" SET "is_current" = "is_active";

CREATE INDEX "contracts_player_id_is_current_idx" ON "contracts" ("player_id", "is_current");

-- Exactly one current phase per player.
CREATE UNIQUE INDEX "contracts_one_current_per_player"
  ON "contracts" ("player_id")
  WHERE "is_current" = true;

-- ── managers ────────────────────────────────────────────────────────────────
CREATE TABLE "managers" (
  "id"         TEXT NOT NULL,
  "club_id"    TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "managers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "managers_club_id_is_active_idx" ON "managers" ("club_id", "is_active");

ALTER TABLE "managers"
  ADD CONSTRAINT "managers_club_id_fkey"
  FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active manager per club (the live Head Coach).
CREATE UNIQUE INDEX "managers_one_active_per_club"
  ON "managers" ("club_id")
  WHERE "is_active" = true;

-- ── manager_contracts (mirror of contracts) ─────────────────────────────────
CREATE TABLE "manager_contracts" (
  "id"                    TEXT NOT NULL,
  "manager_id"            TEXT NOT NULL,
  "club_id"               TEXT NOT NULL,
  "compensation_fee"      BIGINT NOT NULL,
  "annual_wage"           BIGINT NOT NULL,
  "agent_fee"             BIGINT NOT NULL,
  "start_date"            TIMESTAMP(3) NOT NULL,
  "end_date"              TIMESTAMP(3) NOT NULL,
  "contract_length_years" DECIMAL(65,30) NOT NULL,
  "book_value"            BIGINT NOT NULL,
  "phase_type"            TEXT NOT NULL DEFAULT 'INITIAL',
  "is_current"            BOOLEAN NOT NULL DEFAULT true,
  "superseded_at"         TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manager_contracts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "manager_contracts"
  ADD CONSTRAINT "manager_contracts_phase_type_check"
  CHECK ("phase_type" IN ('INITIAL', 'EXTENSION'));

CREATE INDEX "manager_contracts_club_id_idx" ON "manager_contracts" ("club_id");
CREATE INDEX "manager_contracts_manager_id_is_current_idx" ON "manager_contracts" ("manager_id", "is_current");

ALTER TABLE "manager_contracts"
  ADD CONSTRAINT "manager_contracts_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "manager_contracts"
  ADD CONSTRAINT "manager_contracts_club_id_fkey"
  FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one current phase per manager.
CREATE UNIQUE INDEX "manager_contracts_one_current_per_manager"
  ON "manager_contracts" ("manager_id")
  WHERE "is_current" = true;
