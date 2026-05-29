-- Shirt / squad number for players (sporting directors sort the roster by it).
-- Nullable: existing players and template-hydrated players start unassigned.
ALTER TABLE "players" ADD COLUMN "squad_number" INTEGER;
