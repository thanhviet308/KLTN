import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteDomain1791072000000 implements MigrationInterface {
  name = 'CompleteDomain1791072000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const database = await queryRunner.getCurrentDatabase();
    await queryRunner.query(
      `CREATE TABLE "attachments" ("client_request_id" uuid NOT NULL, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "uploader_id" uuid NOT NULL, "message_id" uuid, "object_key" character varying(1024) NOT NULL, "file_name" character varying(255) NOT NULL, "mime_type" character varying(127) NOT NULL, "size" bigint NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "upload_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_2a5b1a5dd03ed69f90533041d3e" UNIQUE ("object_key"), CONSTRAINT "attachments_client_request" UNIQUE ("uploader_id", "client_request_id"), CONSTRAINT "attachments_times" CHECK (upload_expires_at > created_at AND (completed_at IS NULL OR completed_at >= created_at)), CONSTRAINT "attachments_completion_state" CHECK ((status = 'pending' AND completed_at IS NULL) OR (status IN ('uploaded', 'attached') AND completed_at IS NOT NULL) OR status IN ('rejected', 'expired')), CONSTRAINT "attachments_message_state" CHECK ((status = 'attached' AND message_id IS NOT NULL) OR (status <> 'attached' AND message_id IS NULL)), CONSTRAINT "attachments_metadata_valid" CHECK (length(btrim(object_key)) > 0 AND length(btrim(file_name)) > 0 AND position('/' IN mime_type) > 1), CONSTRAINT "attachments_size_valid" CHECK (size > 0 AND size <= 104857600), CONSTRAINT "attachments_status_valid" CHECK (status IN ('pending', 'uploaded', 'attached', 'rejected', 'expired')), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "attachments_pending_expiry_idx" ON "attachments" ("upload_expires_at") WHERE status = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX "attachments_message_idx" ON "attachments" ("conversation_id", "message_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "attachments_uploader_status_idx" ON "attachments" ("uploader_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "calls" ("client_request_id" uuid NOT NULL, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "initiator_id" uuid NOT NULL, "room_name" character varying(200) NOT NULL, "type" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'ringing', "ring_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1fb7e21b027015d1e96f17f7326" UNIQUE ("room_name"), CONSTRAINT "calls_conversation_id" UNIQUE ("conversation_id", "id"), CONSTRAINT "calls_client_request" UNIQUE ("initiator_id", "client_request_id"), CONSTRAINT "calls_times_ordered" CHECK (ring_expires_at > created_at AND (started_at IS NULL OR started_at >= created_at) AND (ended_at IS NULL OR ended_at >= created_at) AND (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at)), CONSTRAINT "calls_state_times" CHECK ((status = 'ringing' AND started_at IS NULL AND ended_at IS NULL) OR (status = 'active' AND started_at IS NOT NULL AND ended_at IS NULL) OR (status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL) OR (status IN ('rejected', 'missed', 'cancelled') AND started_at IS NULL AND ended_at IS NOT NULL)), CONSTRAINT "calls_room_present" CHECK (length(btrim(room_name)) > 0), CONSTRAINT "calls_status_valid" CHECK (status IN ('ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled')), CONSTRAINT "calls_type_valid" CHECK (type IN ('audio', 'video')), CONSTRAINT "PK_d9171d91f8dd1a649659f1b6a20" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "calls_ringing_expiry_idx" ON "calls" ("ring_expires_at") WHERE status = 'ringing'`,
    );
    await queryRunner.query(
      `CREATE INDEX "calls_initiator_idx" ON "calls" ("initiator_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "calls_conversation_history_idx" ON "calls" ("conversation_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "calls_one_open_idx" ON "calls" ("conversation_id") WHERE status IN ('ringing', 'active')`,
    );
    await queryRunner.query(
      `CREATE TABLE "call_participants" ("call_id" uuid NOT NULL, "user_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'invited', "invited_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "joined_at" TIMESTAMP WITH TIME ZONE, "left_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "call_participants_times" CHECK (joined_at IS NULL OR (joined_at >= invited_at AND (left_at IS NULL OR left_at >= joined_at))), CONSTRAINT "call_participants_state_times" CHECK ((status IN ('invited', 'accepted', 'rejected', 'missed', 'cancelled') AND joined_at IS NULL AND left_at IS NULL) OR (status = 'joined' AND joined_at IS NOT NULL AND left_at IS NULL) OR (status = 'left' AND joined_at IS NOT NULL AND left_at IS NOT NULL)), CONSTRAINT "call_participants_status_valid" CHECK (status IN ('invited', 'accepted', 'joined', 'left', 'rejected', 'missed', 'cancelled')), CONSTRAINT "PK_df6450e31039538500fe0452d50" PRIMARY KEY ("call_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "call_participants_member_idx" ON "call_participants" ("conversation_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "call_participants_user_history_idx" ON "call_participants" ("user_id", "invited_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "device_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "platform" character varying(16) NOT NULL, "token" character varying(4096) NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_977e24c520c49436d08e5eeea8a" UNIQUE ("token"), CONSTRAINT "device_tokens_revocation_time" CHECK (revoked_at IS NULL OR revoked_at >= created_at), CONSTRAINT "device_tokens_token_present" CHECK (length(btrim(token)) > 0), CONSTRAINT "device_tokens_platform_valid" CHECK (platform IN ('web', 'android')), CONSTRAINT "device_tokens_token_size" CHECK (octet_length(token) <= 2048), CONSTRAINT "PK_84700be257607cfb1f9dc2e52c3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "device_tokens_active_user_idx" ON "device_tokens" ("user_id") WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "type" character varying(32) NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "deduplication_key" character varying(200), "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "notifications_dedupe" UNIQUE ("user_id", "deduplication_key"), CONSTRAINT "notifications_dedupe_present" CHECK (deduplication_key IS NULL OR length(btrim(deduplication_key)) > 0), CONSTRAINT "notifications_read_time" CHECK (read_at IS NULL OR read_at >= created_at), CONSTRAINT "notifications_payload_valid" CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384), CONSTRAINT "notifications_type_valid" CHECK (type IN ('friend_request', 'friend_accepted', 'message', 'call', 'ai_completed', 'ai_failed', 'report_updated')), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id", "created_at") WHERE read_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_user_cursor_idx" ON "notifications" ("user_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_jobs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "client_request_id" uuid NOT NULL, "conversation_id" uuid, "kind" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'queued', "input_start_sequence" bigint, "input_end_sequence" bigint, "input" jsonb NOT NULL DEFAULT '{}'::jsonb, "output" text, "error_code" character varying(64), "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ai_jobs_client_request" UNIQUE ("user_id", "client_request_id"), CONSTRAINT "ai_jobs_times" CHECK ((started_at IS NULL OR started_at >= created_at) AND (finished_at IS NULL OR finished_at >= created_at) AND (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at)), CONSTRAINT "ai_jobs_state_valid" CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND output IS NOT NULL AND error_code IS NULL) OR (status = 'failed' AND finished_at IS NOT NULL AND output IS NULL AND error_code IS NOT NULL) OR (status = 'cancelled' AND finished_at IS NOT NULL AND output IS NULL)), CONSTRAINT "ai_jobs_output_size" CHECK (output IS NULL OR octet_length(output) <= 1048576), CONSTRAINT "ai_jobs_input_valid" CHECK (jsonb_typeof(input) = 'object' AND octet_length(input::text) <= 65536), CONSTRAINT "ai_jobs_range_valid" CHECK ((conversation_id IS NULL AND input_start_sequence IS NULL AND input_end_sequence IS NULL AND kind = 'chat') OR (conversation_id IS NOT NULL AND input_start_sequence IS NOT NULL AND input_end_sequence IS NOT NULL AND input_start_sequence > 0 AND input_end_sequence >= input_start_sequence)), CONSTRAINT "ai_jobs_status_valid" CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')), CONSTRAINT "ai_jobs_kind_valid" CHECK (kind IN ('chat', 'summary', 'reply_suggestions')), CONSTRAINT "ai_jobs_error_code_valid" CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'), CONSTRAINT "PK_895e59e4adb993a3f45dacb1d6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ai_jobs_conversation_idx" ON "ai_jobs" ("conversation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ai_jobs_queue_idx" ON "ai_jobs" ("created_at", "id") WHERE status = 'queued'`,
    );
    await queryRunner.query(
      `CREATE INDEX "ai_jobs_user_cursor_idx" ON "ai_jobs" ("user_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `INSERT INTO "public"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        'public',
        'reports',
        'GENERATED_COLUMN',
        'target_id',
        'COALESCE(reported_user_id, reported_conversation_id, reported_message_id, reported_call_id, reported_attachment_id)',
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "reporter_id" uuid NOT NULL, "target_type" character varying(16) NOT NULL, "reported_user_id" uuid, "reported_conversation_id" uuid, "reported_message_id" uuid, "reported_call_id" uuid, "reported_attachment_id" uuid, "target_id" uuid GENERATED ALWAYS AS (COALESCE(reported_user_id, reported_conversation_id, reported_message_id, reported_call_id, reported_attachment_id)) STORED NOT NULL, "reason" character varying(2000) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'open', "reviewer_id" uuid, "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb, "resolution" character varying(2000), "reviewed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "reports_review_time" CHECK (reviewed_at IS NULL OR reviewed_at >= created_at), CONSTRAINT "reports_review_state" CHECK ((status = 'open' AND reviewer_id IS NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status = 'reviewing' AND reviewer_id IS NOT NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status IN ('resolved', 'dismissed') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution)) > 0)), CONSTRAINT "reports_reviewer_separate" CHECK (reviewer_id IS NULL OR reviewer_id <> reporter_id), CONSTRAINT "reports_snapshot_valid" CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 65536), CONSTRAINT "reports_reason_present" CHECK (length(btrim(reason)) > 0), CONSTRAINT "reports_status_valid" CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')), CONSTRAINT "reports_target_valid" CHECK (num_nonnulls(reported_user_id, reported_conversation_id, reported_message_id, reported_call_id, reported_attachment_id) = 1 AND ((target_type = 'user' AND reported_user_id IS NOT NULL) OR (target_type = 'conversation' AND reported_conversation_id IS NOT NULL) OR (target_type = 'message' AND reported_message_id IS NOT NULL) OR (target_type = 'call' AND reported_call_id IS NOT NULL) OR (target_type = 'attachment' AND reported_attachment_id IS NOT NULL))), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_attachment_target_idx" ON "reports" ("reported_attachment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_call_target_idx" ON "reports" ("reported_call_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_message_target_idx" ON "reports" ("reported_message_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_conversation_target_idx" ON "reports" ("reported_conversation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_user_target_idx" ON "reports" ("reported_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_reviewer_idx" ON "reports" ("reviewer_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "reports_queue_idx" ON "reports" ("status", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "reports_one_open_target_idx" ON "reports" ("reporter_id", "target_type", "target_id") WHERE status IN ('open', 'reviewing')`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_id" uuid, "action" character varying(100) NOT NULL, "target_type" character varying(32), "target_id" uuid, "request_id" uuid, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "audit_logs_metadata_valid" CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384), CONSTRAINT "audit_logs_target_pair" CHECK ((target_type IS NULL AND target_id IS NULL) OR (target_type IS NOT NULL AND length(btrim(target_type)) > 0 AND target_id IS NOT NULL)), CONSTRAINT "audit_logs_action_present" CHECK (length(btrim(action)) > 0), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_logs_created_idx" ON "audit_logs" ("created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_logs_target_idx" ON "audit_logs" ("target_type", "target_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_logs_actor_cursor_idx" ON "audit_logs" ("actor_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "body" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_sender_id" UNIQUE ("conversation_id", "sender_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_9c1081ce2fdde6f33ce2105b582" FOREIGN KEY ("conversation_id", "uploader_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_c7033e9743716f89101ff99ac59" FOREIGN KEY ("conversation_id", "uploader_id", "message_id") REFERENCES "messages"("conversation_id","sender_id","id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calls" ADD CONSTRAINT "FK_f5a258ca31aeacc63b486438727" FOREIGN KEY ("conversation_id", "initiator_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_participants" ADD CONSTRAINT "FK_cd9b0f0439537257cce459f37d5" FOREIGN KEY ("conversation_id", "call_id") REFERENCES "calls"("conversation_id","id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_participants" ADD CONSTRAINT "FK_09e876dbd7b8f12538210cda707" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_tokens" ADD CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" ADD CONSTRAINT "FK_7ee7849fc020f606c147acb4fe1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" ADD CONSTRAINT "FK_b7777b63d607e325b4f104df92e" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" ADD CONSTRAINT "FK_573251c05bdb5174617669a23a0" FOREIGN KEY ("conversation_id", "input_start_sequence") REFERENCES "messages"("conversation_id","sequence") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" ADD CONSTRAINT "FK_f37e700d10d62016151c4396f39" FOREIGN KEY ("conversation_id", "input_end_sequence") REFERENCES "messages"("conversation_id","sequence") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_9459b9bf907a3807ef7143d2ead" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_a9197bd0a7e06bb92648d9efed2" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_9cabb870caed0dde1c6ce8dc7a1" FOREIGN KEY ("reported_conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_ddab82184f18e5224bae188e724" FOREIGN KEY ("reported_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_3b0079be4e91ff24cfdd10586c7" FOREIGN KEY ("reported_call_id") REFERENCES "calls"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_6504d2683f869431c18fc975d60" FOREIGN KEY ("reported_attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_8a771ab9cef7da26ac94fb11d92" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Explicit CHECK replacement: TypeORM compares check names, not changed expressions.
    await queryRunner.query(`
ALTER TABLE messages DROP CONSTRAINT messages_type_valid;
ALTER TABLE messages ADD CONSTRAINT messages_type_valid CHECK (type IN ('text', 'image', 'file'));
ALTER TABLE messages DROP CONSTRAINT messages_body_valid;
ALTER TABLE messages ADD CONSTRAINT messages_body_valid CHECK (
  (type = 'text' AND body IS NOT NULL AND length(btrim(body)) > 0 AND char_length(body) <= 10000)
  OR (type IN ('image', 'file') AND (body IS NULL OR char_length(body) <= 10000))
);
CREATE TRIGGER attachments_updated_at BEFORE UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER calls_updated_at BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER call_participants_updated_at BEFORE UPDATE ON call_participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER device_tokens_updated_at BEFORE UPDATE ON device_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ai_jobs_updated_at BEFORE UPDATE ON ai_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reports_updated_at BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION validate_message_attachments() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_ids uuid[];
  target_id uuid;
  target_message messages%ROWTYPE;
  attachment_count integer;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    target_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    target_ids := ARRAY[NEW.message_id];
  ELSIF TG_OP = 'DELETE' THEN
    target_ids := ARRAY[OLD.message_id];
  ELSE
    target_ids := ARRAY[OLD.message_id, NEW.message_id];
  END IF;
  FOREACH target_id IN ARRAY target_ids LOOP
    IF target_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO target_message FROM messages WHERE id = target_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT count(*) INTO attachment_count FROM attachments WHERE message_id = target_id AND status = 'attached';
    IF (target_message.type = 'text' AND attachment_count <> 0)
      OR (target_message.type IN ('image', 'file') AND attachment_count = 0) THEN
      RAISE EXCEPTION 'Message type and attachments are inconsistent' USING ERRCODE = '23514';
    END IF;
    IF target_message.type = 'image' AND EXISTS (
      SELECT 1 FROM attachments WHERE message_id = target_id AND status = 'attached' AND mime_type NOT LIKE 'image/%'
    ) THEN
      RAISE EXCEPTION 'Image message requires image attachments' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER messages_attachment_consistency AFTER INSERT OR UPDATE ON messages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_message_attachments();
CREATE CONSTRAINT TRIGGER attachments_message_consistency AFTER INSERT OR UPDATE OR DELETE ON attachments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_message_attachments();

CREATE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION deny_audit_mutation();
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const database = await queryRunner.getCurrentDatabase();
    await queryRunner.query(`
DROP TRIGGER attachments_message_consistency ON attachments;
DROP TRIGGER messages_attachment_consistency ON messages;
DROP FUNCTION validate_message_attachments();
ALTER TABLE messages DROP CONSTRAINT messages_type_valid;
ALTER TABLE messages ADD CONSTRAINT messages_type_valid CHECK (type = 'text');
ALTER TABLE messages DROP CONSTRAINT messages_body_valid;
ALTER TABLE messages ADD CONSTRAINT messages_body_valid CHECK (length(btrim(body)) > 0 AND char_length(body) <= 10000);
`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_8a771ab9cef7da26ac94fb11d92"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_6504d2683f869431c18fc975d60"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_3b0079be4e91ff24cfdd10586c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_ddab82184f18e5224bae188e724"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_9cabb870caed0dde1c6ce8dc7a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_a9197bd0a7e06bb92648d9efed2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_9459b9bf907a3807ef7143d2ead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" DROP CONSTRAINT "FK_f37e700d10d62016151c4396f39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" DROP CONSTRAINT "FK_573251c05bdb5174617669a23a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" DROP CONSTRAINT "FK_b7777b63d607e325b4f104df92e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_jobs" DROP CONSTRAINT "FK_7ee7849fc020f606c147acb4fe1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_9a8a82462cab47c73d25f49261f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_tokens" DROP CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_participants" DROP CONSTRAINT "FK_09e876dbd7b8f12538210cda707"`,
    );
    await queryRunner.query(
      `ALTER TABLE "call_participants" DROP CONSTRAINT "FK_cd9b0f0439537257cce459f37d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calls" DROP CONSTRAINT "FK_f5a258ca31aeacc63b486438727"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP CONSTRAINT "FK_c7033e9743716f89101ff99ac59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP CONSTRAINT "FK_9c1081ce2fdde6f33ce2105b582"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_sender_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ALTER COLUMN "body" SET NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."audit_logs_actor_cursor_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."audit_logs_target_idx"`);
    await queryRunner.query(`DROP INDEX "public"."audit_logs_created_idx"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."reports_one_open_target_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."reports_queue_idx"`);
    await queryRunner.query(`DROP INDEX "public"."reports_reviewer_idx"`);
    await queryRunner.query(`DROP INDEX "public"."reports_user_target_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."reports_conversation_target_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."reports_message_target_idx"`);
    await queryRunner.query(`DROP INDEX "public"."reports_call_target_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."reports_attachment_target_idx"`,
    );
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(
      `DELETE FROM "public"."typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'target_id', database, 'public', 'reports'],
    );
    await queryRunner.query(`DROP INDEX "public"."ai_jobs_user_cursor_idx"`);
    await queryRunner.query(`DROP INDEX "public"."ai_jobs_queue_idx"`);
    await queryRunner.query(`DROP INDEX "public"."ai_jobs_conversation_idx"`);
    await queryRunner.query(`DROP TABLE "ai_jobs"`);
    await queryRunner.query(
      `DROP INDEX "public"."notifications_user_cursor_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."notifications_unread_idx"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(
      `DROP INDEX "public"."device_tokens_active_user_idx"`,
    );
    await queryRunner.query(`DROP TABLE "device_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."call_participants_user_history_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."call_participants_member_idx"`,
    );
    await queryRunner.query(`DROP TABLE "call_participants"`);
    await queryRunner.query(`DROP INDEX "public"."calls_one_open_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."calls_conversation_history_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."calls_initiator_idx"`);
    await queryRunner.query(`DROP INDEX "public"."calls_ringing_expiry_idx"`);
    await queryRunner.query(`DROP TABLE "calls"`);
    await queryRunner.query(
      `DROP INDEX "public"."attachments_uploader_status_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."attachments_message_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."attachments_pending_expiry_idx"`,
    );
    await queryRunner.query(`DROP TABLE "attachments"`);
    await queryRunner.query('DROP FUNCTION deny_audit_mutation()');
  }
}
