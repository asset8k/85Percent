-- Shirt number for template roster items, scraped from each player's
-- Transfermarkt profile (the bulk squad endpoint omits it). Nullable: unknown
-- numbers and managers stay null. Carried into players.squad_number on hydration.
ALTER TABLE "template_roster_items" ADD COLUMN "squad_number" INTEGER;
