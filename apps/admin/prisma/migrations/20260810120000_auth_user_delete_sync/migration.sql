-- Keeps public.users in sync when an account is removed straight from
-- auth.users (e.g. via the Supabase dashboard), which previously left an
-- orphaned public.users row that the admin Users page kept listing forever —
-- the app's own "Delete user" button (apps/admin/app/actions/users.ts) was
-- the only thing that ever cleaned up both sides together.
--
-- Mirrors that action's own cascade order exactly: audit_logs and
-- scenarios.created_by are ON DELETE RESTRICT (see baseline_schema.sql), so
-- they must be cleared before the public.users row itself can go.
CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guarded with to_regclass: dev and prod have drifted before (prod is
  -- missing chat_sessions/chat_messages entirely as of this writing), and an
  -- unconditional DELETE against a table that doesn't exist on one
  -- environment throws "relation does not exist", which aborts this trigger
  -- and silently blocks every auth.users deletion on that environment.
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
