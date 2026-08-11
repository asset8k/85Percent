-- The policy was applied manually through Supabase SQL in existing hosted
-- environments. Record the same idempotent change in Prisma's history so a
-- fresh Dev or Production database receives it during `prisma migrate deploy`.
DO $$
BEGIN
  IF to_regclass('public.player_registration_assets') IS NOT NULL THEN
    ALTER TABLE public.player_registration_assets ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "player_registration_assets: own club only"
      ON public.player_registration_assets;

    CREATE POLICY "player_registration_assets: own club only"
      ON public.player_registration_assets
      FOR ALL
      USING (club_id = public.current_club_id())
      WITH CHECK (club_id = public.current_club_id());
  END IF;
END;
$$;
