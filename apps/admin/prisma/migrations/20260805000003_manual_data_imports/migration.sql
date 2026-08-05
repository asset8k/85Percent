CREATE TYPE "DataImportType" AS ENUM ('CLUB_SQUAD', 'LEAGUE_STANDINGS');
CREATE TYPE "DataImportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED');
CREATE TYPE "DataImportTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "DataImportStage" AS ENUM ('QUEUED', 'FETCHING', 'NORMALISING', 'MATCHING', 'APPLYING', 'VERIFYING', 'COMPLETED');
CREATE TYPE "DataImportChangeStatus" AS ENUM ('AUTO_APPLY', 'NEEDS_REVIEW', 'APPLIED', 'APPROVED', 'REJECTED');

CREATE TABLE "data_import_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "DataImportType" NOT NULL,
  "status" "DataImportRunStatus" NOT NULL DEFAULT 'QUEUED',
  "requested_by_user_id" TEXT NOT NULL,
  "league_id" TEXT,
  "provider" TEXT NOT NULL,
  "total_tasks" INTEGER NOT NULL DEFAULT 0,
  "completed_tasks" INTEGER NOT NULL DEFAULT 0,
  "succeeded_tasks" INTEGER NOT NULL DEFAULT 0,
  "failed_tasks" INTEGER NOT NULL DEFAULT 0,
  "skipped_tasks" INTEGER NOT NULL DEFAULT 0,
  "progress_percent" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "last_heartbeat_at" TIMESTAMPTZ,
  "error_summary" TEXT,
  "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_import_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "import_run_id" UUID NOT NULL,
  "template_club_id" TEXT,
  "external_club_id" TEXT,
  "competition" "TemplateLeague",
  "status" "DataImportTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "current_stage" "DataImportStage" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "duration_ms" INTEGER,
  "added_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "unchanged_count" INTEGER NOT NULL DEFAULT 0,
  "review_count" INTEGER NOT NULL DEFAULT 0,
  "missing_count" INTEGER NOT NULL DEFAULT 0,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "safe_error_message" TEXT,
  "provider_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_snapshot" JSONB,
  "idempotency_key" TEXT NOT NULL,
  "last_heartbeat_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_import_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_import_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "import_run_id" UUID NOT NULL,
  "import_task_id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "change_type" TEXT NOT NULL,
  "status" "DataImportChangeStatus" NOT NULL,
  "internal_entity_id" TEXT,
  "external_entity_id" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_import_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_source_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "internal_id" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "template_club_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_seen_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_source_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_import_tasks_idempotency_key_key" ON "data_import_tasks"("idempotency_key");
CREATE INDEX "data_import_runs_status_created_at_idx" ON "data_import_runs"("status", "created_at");
CREATE INDEX "data_import_tasks_import_run_id_status_idx" ON "data_import_tasks"("import_run_id", "status");
CREATE INDEX "data_import_tasks_template_club_id_status_idx" ON "data_import_tasks"("template_club_id", "status");
CREATE UNIQUE INDEX "data_import_tasks_one_active_club_idx"
  ON "data_import_tasks"("template_club_id")
  WHERE "template_club_id" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING');
CREATE UNIQUE INDEX "data_import_tasks_one_active_competition_idx"
  ON "data_import_tasks"("competition")
  WHERE "template_club_id" IS NULL AND "competition" IS NOT NULL
    AND "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "data_import_changes_import_run_id_status_idx" ON "data_import_changes"("import_run_id", "status");
CREATE INDEX "data_import_changes_import_task_id_status_idx" ON "data_import_changes"("import_task_id", "status");
CREATE UNIQUE INDEX "external_source_mappings_provider_entity_type_external_id_key" ON "external_source_mappings"("provider", "entity_type", "external_id");
CREATE UNIQUE INDEX "external_source_mappings_provider_entity_type_internal_id_key" ON "external_source_mappings"("provider", "entity_type", "internal_id");
CREATE INDEX "external_source_mappings_template_club_id_entity_type_idx" ON "external_source_mappings"("template_club_id", "entity_type");

ALTER TABLE "data_import_tasks" ADD CONSTRAINT "data_import_tasks_import_run_id_fkey"
  FOREIGN KEY ("import_run_id") REFERENCES "data_import_runs"("id") ON DELETE CASCADE;
ALTER TABLE "data_import_tasks" ADD CONSTRAINT "data_import_tasks_template_club_id_fkey"
  FOREIGN KEY ("template_club_id") REFERENCES "template_clubs"("id") ON DELETE RESTRICT;
ALTER TABLE "data_import_changes" ADD CONSTRAINT "data_import_changes_import_run_id_fkey"
  FOREIGN KEY ("import_run_id") REFERENCES "data_import_runs"("id") ON DELETE CASCADE;
ALTER TABLE "data_import_changes" ADD CONSTRAINT "data_import_changes_import_task_id_fkey"
  FOREIGN KEY ("import_task_id") REFERENCES "data_import_tasks"("id") ON DELETE CASCADE;
ALTER TABLE "external_source_mappings" ADD CONSTRAINT "external_source_mappings_template_club_id_fkey"
  FOREIGN KEY ("template_club_id") REFERENCES "template_clubs"("id") ON DELETE CASCADE;

ALTER TABLE "data_import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_import_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_import_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_source_mappings" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION claim_data_import_task(p_task_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed_count integer;
BEGIN
  UPDATE data_import_tasks t
     SET status = 'RUNNING', current_stage = 'FETCHING', attempts = attempts + 1,
         started_at = COALESCE(started_at, now()), last_heartbeat_at = now(), updated_at = now()
    FROM data_import_runs r
   WHERE t.id = p_task_id AND r.id = t.import_run_id
     AND t.status = 'QUEUED' AND r.status IN ('QUEUED', 'RUNNING')
     AND t.attempts < t.max_attempts;
  GET DIAGNOSTICS claimed_count = ROW_COUNT;
  IF claimed_count > 0 THEN
    UPDATE data_import_runs SET status = 'RUNNING', started_at = COALESCE(started_at, now()),
      last_heartbeat_at = now(), updated_at = now() WHERE id = (SELECT import_run_id FROM data_import_tasks WHERE id = p_task_id);
  END IF;
  RETURN claimed_count > 0;
END $$;

CREATE OR REPLACE FUNCTION refresh_data_import_run(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total_count int; done_count int; ok_count int; fail_count int; cancel_count int; next_status "DataImportRunStatus";
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status IN ('SUCCEEDED','FAILED','CANCELLED')),
         count(*) FILTER (WHERE status='SUCCEEDED'), count(*) FILTER (WHERE status='FAILED'),
         count(*) FILTER (WHERE status='CANCELLED')
    INTO total_count, done_count, ok_count, fail_count, cancel_count
    FROM data_import_tasks WHERE import_run_id = p_run_id;
  IF done_count < total_count THEN
    next_status := CASE WHEN EXISTS (SELECT 1 FROM data_import_runs WHERE id=p_run_id AND status='CANCELLING')
      THEN 'CANCELLING' ELSE 'RUNNING' END;
  ELSIF cancel_count = total_count THEN next_status := 'CANCELLED';
  ELSIF fail_count = total_count THEN next_status := 'FAILED';
  ELSIF fail_count > 0 OR cancel_count > 0 THEN next_status := 'PARTIAL_SUCCESS';
  ELSE next_status := 'SUCCEEDED'; END IF;
  UPDATE data_import_runs SET status=next_status, total_tasks=total_count, completed_tasks=done_count,
    succeeded_tasks=ok_count, failed_tasks=fail_count, skipped_tasks=cancel_count,
    progress_percent=CASE WHEN total_count=0 THEN 0 ELSE floor(done_count*100.0/total_count)::int END,
    completed_at=CASE WHEN done_count=total_count THEN now() ELSE NULL END,
    cancelled_at=CASE WHEN next_status='CANCELLED' THEN now() ELSE cancelled_at END,
    last_heartbeat_at=now(), updated_at=now() WHERE id=p_run_id;
END $$;

CREATE OR REPLACE FUNCTION apply_template_import_task(p_task_id uuid, p_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; new_id text;
BEGIN
  PERFORM 1 FROM data_import_tasks WHERE id=p_task_id FOR UPDATE;
  FOR c IN SELECT * FROM data_import_changes WHERE import_task_id=p_task_id AND status IN ('AUTO_APPLY','APPROVED') ORDER BY created_at LOOP
    IF c.entity_type IN ('PLAYER','COACH') AND c.change_type='ADD' THEN
      new_id := gen_random_uuid()::text;
      INSERT INTO template_roster_items(id, template_club_id, name, date_of_birth, nationality, position,
        squad_number, is_manager, estimated_transfer_fee, contract_start, contract_end, joined_date,
        contract_start_from_extension, created_at, updated_at)
      SELECT new_id, t.template_club_id, c.after_data->>'name', NULLIF(c.after_data->>'dateOfBirth','')::timestamp,
        NULLIF(c.after_data->>'nationality',''), NULLIF(c.after_data->>'position','')::"TemplatePosition",
        NULLIF(c.after_data->>'squadNumber','')::int, c.entity_type='COACH', NULL,
        NULLIF(c.after_data->>'contractStart','')::timestamp, NULLIF(c.after_data->>'contractEnd','')::timestamp,
        NULLIF(c.after_data->>'joinedDate','')::timestamp, false, now(), now()
      FROM data_import_tasks t WHERE t.id=p_task_id;
      IF c.external_entity_id IS NOT NULL THEN
        DELETE FROM external_source_mappings
        WHERE provider=p_provider AND entity_type=c.entity_type
          AND internal_id=new_id AND external_id<>c.external_entity_id;
        INSERT INTO external_source_mappings(provider, entity_type, internal_id, external_id, template_club_id, last_seen_at)
        SELECT p_provider, c.entity_type, new_id, c.external_entity_id, t.template_club_id, now()
        FROM data_import_tasks t WHERE t.id=p_task_id
        ON CONFLICT(provider, entity_type, external_id) DO UPDATE SET internal_id=excluded.internal_id,
          template_club_id=excluded.template_club_id, last_seen_at=now(), updated_at=now();
      END IF;
      UPDATE data_import_changes SET internal_entity_id=new_id WHERE id=c.id;
    ELSIF c.entity_type IN ('PLAYER','COACH') AND (c.change_type='UPDATE' OR (c.entity_type='COACH' AND c.change_type='CONFLICT')) THEN
      UPDATE template_roster_items SET
        name=CASE WHEN c.after_data ? 'name' THEN c.after_data->>'name' ELSE name END,
        date_of_birth=CASE WHEN c.after_data ? 'dateOfBirth' THEN NULLIF(c.after_data->>'dateOfBirth','')::timestamp ELSE date_of_birth END,
        nationality=CASE WHEN c.after_data ? 'nationality' THEN NULLIF(c.after_data->>'nationality','') ELSE nationality END,
        position=CASE WHEN c.after_data ? 'position' THEN NULLIF(c.after_data->>'position','')::"TemplatePosition" ELSE position END,
        squad_number=CASE WHEN c.after_data ? 'squadNumber' THEN NULLIF(c.after_data->>'squadNumber','')::int ELSE squad_number END,
        contract_start=CASE WHEN c.after_data ? 'contractStart' THEN NULLIF(c.after_data->>'contractStart','')::timestamp ELSE contract_start END,
        contract_end=CASE WHEN c.after_data ? 'contractEnd' THEN NULLIF(c.after_data->>'contractEnd','')::timestamp ELSE contract_end END,
        joined_date=CASE WHEN c.after_data ? 'joinedDate' THEN NULLIF(c.after_data->>'joinedDate','')::timestamp ELSE joined_date END,
        updated_at=now()
      WHERE id=c.internal_entity_id;
      IF c.external_entity_id IS NOT NULL THEN
        DELETE FROM external_source_mappings
        WHERE provider=p_provider AND entity_type=c.entity_type
          AND internal_id=c.internal_entity_id AND external_id<>c.external_entity_id;
        INSERT INTO external_source_mappings(provider, entity_type, internal_id, external_id, template_club_id, last_seen_at)
        SELECT p_provider, c.entity_type, c.internal_entity_id, c.external_entity_id, t.template_club_id, now()
        FROM data_import_tasks t WHERE t.id=p_task_id
        ON CONFLICT(provider, entity_type, external_id) DO UPDATE SET internal_id=excluded.internal_id,
          template_club_id=excluded.template_club_id, last_seen_at=now(), updated_at=now();
      END IF;
    ELSIF c.entity_type='CLUB' AND c.change_type='UPDATE' THEN
      UPDATE template_clubs SET logo_url=COALESCE(NULLIF(c.after_data->>'logoUrl',''), logo_url), updated_at=now()
      WHERE id=c.internal_entity_id;
    END IF;
    UPDATE data_import_changes SET status='APPLIED', resolved_at=now(), updated_at=now() WHERE id=c.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION publish_league_snapshot(
  p_league_id text, p_competition text, p_season text, p_source text, p_standings jsonb, p_fetched_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  UPDATE league_table_snapshots SET is_active=false WHERE league_id=p_league_id AND is_active=true;
  INSERT INTO league_table_snapshots(league_id, competition, season, source, standings, is_active, fetched_at)
  VALUES(p_league_id, p_competition, p_season, p_source, p_standings, true, p_fetched_at)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION claim_data_import_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refresh_data_import_run(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_template_import_task(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION publish_league_snapshot(text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_data_import_task(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_data_import_run(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION apply_template_import_task(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION publish_league_snapshot(text, text, text, text, jsonb, timestamptz) TO service_role;
