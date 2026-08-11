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
  DELETE FROM public.chat_sessions WHERE user_id = OLD.id;
  DELETE FROM public.scenarios WHERE created_by = OLD.id;
  DELETE FROM public.audit_logs WHERE user_id = OLD.id;
  DELETE FROM public.notifications WHERE user_id = OLD.id;
  DELETE FROM public.users WHERE id = OLD.id::text;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_deleted();
