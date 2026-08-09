-- A MISSING change means the provider no longer lists this player for the
-- club (they left the squad). Previously this was purely informational; now
-- it actually removes the stale roster row and its source mapping, same as
-- any other AUTO_APPLY change.
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
    ELSIF c.entity_type='PLAYER' AND c.change_type='MISSING' THEN
      DELETE FROM external_source_mappings
      WHERE provider=p_provider AND entity_type='PLAYER' AND internal_id=c.internal_entity_id;
      DELETE FROM template_roster_items WHERE id=c.internal_entity_id;
    ELSIF c.entity_type='CLUB' AND c.change_type='UPDATE' THEN
      UPDATE template_clubs SET logo_url=COALESCE(NULLIF(c.after_data->>'logoUrl',''), logo_url), updated_at=now()
      WHERE id=c.internal_entity_id;
    END IF;
    UPDATE data_import_changes SET status='APPLIED', resolved_at=now(), updated_at=now() WHERE id=c.id;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION apply_template_import_task(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_template_import_task(uuid, text) TO service_role;
