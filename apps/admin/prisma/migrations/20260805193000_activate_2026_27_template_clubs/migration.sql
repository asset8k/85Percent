-- Move the curated template dictionary to the 2026-27 Premier League and
-- Championship membership without deleting historical imports, mappings, or
-- roster snapshots for relegated clubs.
ALTER TABLE "template_clubs"
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Keep the 41 existing catalog records that remain in the two supported
-- competitions, updating relegated/promoted clubs to their 2026-27 league.
UPDATE "template_clubs"
SET
  "league" = CASE
    WHEN "name" IN (
      'AFC Bournemouth', 'Arsenal FC', 'Aston Villa', 'Brentford FC',
      'Brighton & Hove Albion', 'Chelsea FC', 'Coventry City',
      'Crystal Palace', 'Everton FC', 'Fulham FC', 'Hull City', 'Ipswich Town',
      'Leeds United', 'Liverpool FC', 'Manchester City', 'Manchester United',
      'Newcastle United', 'Nottingham Forest', 'Sunderland AFC', 'Tottenham Hotspur'
    ) THEN 'PREMIER_LEAGUE'::"TemplateLeague"
    ELSE 'CHAMPIONSHIP'::"TemplateLeague"
  END,
  "is_active" = true,
  "updated_at" = now()
WHERE "name" IN (
  'AFC Bournemouth', 'Arsenal FC', 'Aston Villa', 'Brentford FC',
  'Brighton & Hove Albion', 'Chelsea FC', 'Coventry City',
  'Crystal Palace', 'Everton FC', 'Fulham FC', 'Hull City', 'Ipswich Town',
  'Leeds United', 'Liverpool FC', 'Manchester City', 'Manchester United',
  'Newcastle United', 'Nottingham Forest', 'Sunderland AFC', 'Tottenham Hotspur',
  'Birmingham City', 'Blackburn Rovers', 'Bristol City', 'Burnley FC',
  'Charlton Athletic', 'Derby County', 'Middlesbrough FC', 'Millwall FC',
  'Norwich City', 'Portsmouth FC', 'Preston North End', 'Queens Park Rangers',
  'Sheffield United', 'Southampton FC', 'Stoke City', 'Swansea City', 'Watford FC',
  'West Bromwich Albion', 'West Ham United', 'Wolverhampton Wanderers', 'Wrexham AFC'
);

-- Add the three League One promotions. Their source mappings and roster data
-- are discovered by the next manual Data Sync run.
INSERT INTO "template_clubs" ("id", "name", "league", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'Bolton Wanderers', 'CHAMPIONSHIP'::"TemplateLeague", true, now(), now()),
  (gen_random_uuid()::text, 'Cardiff City', 'CHAMPIONSHIP'::"TemplateLeague", true, now(), now()),
  (gen_random_uuid()::text, 'Lincoln City', 'CHAMPIONSHIP'::"TemplateLeague", true, now(), now())
ON CONFLICT ("name") DO UPDATE
SET
  "league" = EXCLUDED."league",
  "is_active" = true,
  "updated_at" = now();

-- Relegated or otherwise unsupported historical catalog rows remain intact,
-- but are no longer available in onboarding or Data Sync selection.
UPDATE "template_clubs"
SET "is_active" = false, "updated_at" = now()
WHERE "name" NOT IN (
  'AFC Bournemouth', 'Arsenal FC', 'Aston Villa', 'Brentford FC',
  'Brighton & Hove Albion', 'Chelsea FC', 'Coventry City',
  'Crystal Palace', 'Everton FC', 'Fulham FC', 'Hull City', 'Ipswich Town',
  'Leeds United', 'Liverpool FC', 'Manchester City', 'Manchester United',
  'Newcastle United', 'Nottingham Forest', 'Sunderland AFC', 'Tottenham Hotspur',
  'Birmingham City', 'Blackburn Rovers', 'Bolton Wanderers', 'Bristol City',
  'Burnley FC', 'Cardiff City', 'Charlton Athletic', 'Derby County', 'Lincoln City',
  'Middlesbrough FC', 'Millwall FC', 'Norwich City', 'Portsmouth FC',
  'Preston North End', 'Queens Park Rangers', 'Sheffield United', 'Southampton FC',
  'Stoke City', 'Swansea City', 'Watford FC', 'West Bromwich Albion',
  'West Ham United', 'Wolverhampton Wanderers', 'Wrexham AFC'
);
