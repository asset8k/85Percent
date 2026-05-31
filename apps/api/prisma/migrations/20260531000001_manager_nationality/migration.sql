-- Head coaches now carry a nationality (parsed from the template Coaching Staff
-- page) so the Roster can show their flag, mirroring players. Nullable: managers
-- created before this column, or without a parsed nationality, have none.
ALTER TABLE "managers" ADD COLUMN "nationality" TEXT;
