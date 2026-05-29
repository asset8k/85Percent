-- Club crest URL, adopted from the chosen onboarding template so the workspace
-- can show the club's logo. Nullable: clubs created before onboarding have none.
ALTER TABLE "clubs" ADD COLUMN "logo_url" TEXT;
