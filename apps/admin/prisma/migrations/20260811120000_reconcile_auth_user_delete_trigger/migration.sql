-- Reconciles the auth-user-delete trigger after the original migration was
-- applied manually in some environments. This stays append-only so Prisma's
-- checksum for 20260810120000_auth_user_delete_sync remains immutable.
CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Optional application tables have drifted between hosted environments.
  -- Their absence must not prevent an Auth user from being deleted.
  IF to_regclass('public.chat_sessions') IS NOT NULL THEN
    DELETE FROM public.chat_sessions WHERE user_id = OLD.id::text;
  END IF;
  IF to_regclass('public.scenarios') IS NOT NULL THEN
    DELETE FROM public.scenarios WHERE created_by = OLD.id::text;
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    DELETE FROM public.audit_logs WHERE user_id = OLD.id::text;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = OLD.id::text;
  END IF;
  DELETE FROM public.users WHERE id = OLD.id::text;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_deleted();
