import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceFeatures1794268800000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE messages DROP CONSTRAINT messages_content_valid,
        ADD CONSTRAINT messages_content_valid CHECK (COALESCE((
          (type='text' AND (content IS NULL OR (jsonb_typeof(content)='object' AND octet_length(content::text)<=16384))) OR
          (type IN ('image','file','voice') AND content->>'attachmentId' IS NOT NULL) OR
          (type='location' AND jsonb_typeof(content->'latitude')='number' AND jsonb_typeof(content->'longitude')='number'
            AND (content->>'latitude')::numeric BETWEEN -90 AND 90 AND (content->>'longitude')::numeric BETWEEN -180 AND 180) OR
          (type='call' AND content->>'callId' IS NOT NULL AND content->>'callType' IN ('audio','video')
            AND content->>'callStatus' IN ('ended','rejected','missed','cancelled') AND jsonb_typeof(content->'durationSeconds')='number'
            AND (content->>'durationSeconds')::integer>=0)),false));
      CREATE TABLE message_search_index (
        message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        tokens text[] NOT NULL
      );
      CREATE INDEX message_search_tokens_idx ON message_search_index USING gin(tokens);
      CREATE FUNCTION invalidate_message_search() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN DELETE FROM message_search_index WHERE message_id = NEW.id; RETURN NEW; END $$;
      CREATE TRIGGER invalidate_message_search AFTER UPDATE OF body, edited_body, deleted_at ON messages
        FOR EACH ROW EXECUTE FUNCTION invalidate_message_search();
      CREATE TABLE message_pins (
        message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES conversations(id),
        user_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX message_pins_conversation_idx ON message_pins(conversation_id, created_at);
      CREATE TABLE group_polls (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL REFERENCES conversations(id),
        creator_id uuid NOT NULL REFERENCES users(id),
        client_request_id uuid NOT NULL,
        question text NOT NULL,
        options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 10),
        multiple boolean NOT NULL DEFAULT false,
        boundary_sequence bigint NOT NULL,
        closed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (creator_id, client_request_id)
      );
      CREATE INDEX group_polls_conversation_idx ON group_polls(conversation_id, id);
      CREATE TABLE poll_votes (
        poll_id uuid NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id),
        options integer[] NOT NULL,
        PRIMARY KEY (poll_id, user_id)
      );
    `);
  }
  async down(q: QueryRunner) {
    await q.query(`DROP TABLE poll_votes; DROP TABLE group_polls; DROP TABLE message_pins;
      DROP TRIGGER invalidate_message_search ON messages; DROP FUNCTION invalidate_message_search(); DROP TABLE message_search_index;`);
  }
}
