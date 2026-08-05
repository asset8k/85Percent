-- Qualify target-table fields. PostgreSQL otherwise treats started_at as
-- ambiguous inside this PL/pgSQL function and leaves local tasks queued.
CREATE OR REPLACE FUNCTION claim_data_import_task(p_task_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed_count integer;
BEGIN
  UPDATE data_import_tasks AS task
     SET status = 'RUNNING', current_stage = 'FETCHING', attempts = task.attempts + 1,
         started_at = COALESCE(task.started_at, now()), last_heartbeat_at = now(), updated_at = now()
    FROM data_import_runs AS run
   WHERE task.id = p_task_id AND run.id = task.import_run_id
     AND task.status = 'QUEUED' AND run.status IN ('QUEUED', 'RUNNING')
     AND task.attempts < task.max_attempts;

  GET DIAGNOSTICS claimed_count = ROW_COUNT;
  IF claimed_count > 0 THEN
    UPDATE data_import_runs AS run
       SET status = 'RUNNING',
           started_at = COALESCE(run.started_at, now()),
           last_heartbeat_at = now(),
           updated_at = now()
     WHERE run.id = (SELECT task.import_run_id FROM data_import_tasks AS task WHERE task.id = p_task_id);
  END IF;
  RETURN claimed_count > 0;
END $$;

REVOKE ALL ON FUNCTION claim_data_import_task(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_data_import_task(uuid) TO service_role;
