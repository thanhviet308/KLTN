import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatMedia1791676800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE messages ADD COLUMN content jsonb');
    await runner.query(`UPDATE messages m SET content = jsonb_build_object(
      'attachmentId', a.id, 'fileName', a.file_name, 'mimeType', a.mime_type, 'size', a.size)
      FROM attachments a WHERE a.message_id = m.id AND a.status = 'attached' AND m.type IN ('image','file')`);
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency IMMEDIATE',
    );
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency DEFERRED',
    );
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_type_valid,
      DROP CONSTRAINT messages_body_valid,
      ADD CONSTRAINT messages_type_valid CHECK (type IN ('text','image','file','voice','location')),
      ADD CONSTRAINT messages_body_valid CHECK (
        (type = 'text' AND body IS NOT NULL AND length(btrim(body)) > 0 AND char_length(body) <= 10000)
        OR (type IN ('image','file','voice','location') AND (body IS NULL OR char_length(body) <= 10000))),
      ADD CONSTRAINT messages_content_valid CHECK (COALESCE((
        (type = 'text' AND content IS NULL) OR
        (type IN ('image','file','voice') AND (content->>'attachmentId') IS NOT NULL) OR
        (type = 'location' AND jsonb_typeof(content->'latitude') = 'number'
          AND jsonb_typeof(content->'longitude') = 'number'
          AND (content->>'latitude')::numeric BETWEEN -90 AND 90
          AND (content->>'longitude')::numeric BETWEEN -180 AND 180)), false))`);
    await runner.query(`CREATE OR REPLACE FUNCTION validate_message_attachments() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE target_ids uuid[]; target_id uuid; target_message messages%ROWTYPE; attachment_count integer;
      BEGIN
        IF TG_TABLE_NAME = 'messages' THEN target_ids := ARRAY[NEW.id];
        ELSIF TG_OP = 'INSERT' THEN target_ids := ARRAY[NEW.message_id];
        ELSIF TG_OP = 'DELETE' THEN target_ids := ARRAY[OLD.message_id];
        ELSE target_ids := ARRAY[OLD.message_id, NEW.message_id]; END IF;
        FOREACH target_id IN ARRAY target_ids LOOP
          IF target_id IS NULL THEN CONTINUE; END IF;
          SELECT * INTO target_message FROM messages WHERE id = target_id FOR NO KEY UPDATE;
          IF NOT FOUND THEN CONTINUE; END IF;
          SELECT count(*) INTO attachment_count FROM attachments WHERE message_id = target_id AND status = 'attached';
          IF (target_message.type IN ('text','location') AND attachment_count <> 0)
            OR (target_message.type IN ('image','file','voice') AND attachment_count <> 1) THEN
            RAISE EXCEPTION 'Message attachments are inconsistent' USING ERRCODE = '23514'; END IF;
          IF target_message.type IN ('image','file','voice') AND NOT EXISTS (
            SELECT 1 FROM attachments WHERE message_id = target_id AND status = 'attached'
              AND id::text = target_message.content->>'attachmentId'
              AND (target_message.type <> 'image' OR mime_type LIKE 'image/%')
              AND (target_message.type <> 'voice' OR mime_type LIKE 'audio/%')) THEN
            RAISE EXCEPTION 'Attachment content is inconsistent' USING ERRCODE = '23514'; END IF;
        END LOOP; RETURN NULL;
      END; $$`);
  }

  async down(): Promise<void> {
    throw new Error(
      'Chat media migration requires explicit data conversion before rollback',
    );
  }
}
