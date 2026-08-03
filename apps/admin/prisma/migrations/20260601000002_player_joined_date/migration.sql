-- Original "joined the club" date, preserved independently of the contract
-- start. When a deal has been extended, the contract start holds the extension
-- date while this keeps the player's original signing date for display / tenure
-- context. Nullable: unknown for rows synced before this, and for manual adds
-- it defaults to the contract start. Mirrored on the template cache so onboarding
-- can carry it through to the live player.
ALTER TABLE "players" ADD COLUMN "joined_date" TIMESTAMP(3);
ALTER TABLE "template_roster_items" ADD COLUMN "joined_date" TIMESTAMP(3);
