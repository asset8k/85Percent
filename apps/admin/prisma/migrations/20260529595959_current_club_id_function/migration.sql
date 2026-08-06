-- Bootstrap prerequisite for the RLS migrations that follow. Earlier hosted
-- environments received this helper through the separate Supabase RLS setup,
-- but a database created solely from the Prisma history needs it here.
CREATE OR REPLACE FUNCTION public.current_club_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.users WHERE id = auth.uid()::text
$$;
