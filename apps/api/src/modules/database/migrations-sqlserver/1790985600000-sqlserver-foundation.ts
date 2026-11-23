import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SqlServerFoundation1790985600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Import data into a schema built by this migration. A partial legacy copy
    // must never be silently marked as a valid baseline.
    await runner.query(`IF EXISTS (SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo') AND name NOT IN ('typeorm_migrations','typeorm_metadata'))
      THROW 51000, 'SQL Server foundation requires an empty application schema. Import records after provisioning the schema.', 1;`);
    await runner.query(`
CREATE TABLE "dbo"."users" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_a3ffb1c0c8416b9fc6f907b7433" DEFAULT NEWSEQUENTIALID(),
  "email" nvarchar(254) NOT NULL,
  "password_hash" nvarchar(MAX) NOT NULL,
  "last_active_at" datetimeoffset,
  "display_name" nvarchar(100) NOT NULL,
  "avatar_key" nvarchar(MAX),
  "role" nvarchar(16) NOT NULL CONSTRAINT "DF_ace513fa30d485cfd25c11a9e4a" DEFAULT 'user',
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_3676155292d72c67cd4e090514f" DEFAULT 'active',
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_c9b5b525a96ddc2c5647d7f7fa5" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_6d596d799f9cb9dac6f7bf7c23c" DEFAULT getdate(),
  CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
  CONSTRAINT "users_status_valid" CHECK (status IN ('active', 'blocked', 'deleted')),
  CONSTRAINT "users_role_valid" CHECK (role IN ('user', 'admin')),
  CONSTRAINT "users_display_name_present" CHECK (LEN(trim(display_name)) > 0),
  CONSTRAINT "users_password_hash_present" CHECK (LEN(trim(password_hash)) > 0),
  CONSTRAINT "users_email_normalized" CHECK (email = lower(trim(email)) AND email NOT LIKE '%[' + CHAR(9) + CHAR(10) + CHAR(11) + CHAR(12) + CHAR(13) + ' ]%' AND CHARINDEX('@', email) > 1),
  CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"));

CREATE TABLE "dbo"."sessions" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_3238ef96f18b355b671619111bc" DEFAULT NEWSEQUENTIALID(),
  "user_id" uniqueidentifier NOT NULL,
  "device_name" nvarchar(200),
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_476aa19b1412e9872ef8f89e87e" DEFAULT getdate(),
  "expires_at" datetimeoffset NOT NULL,
  "revoked_at" datetimeoffset,
  CONSTRAINT "sessions_revocation" CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT "sessions_expiry" CHECK (expires_at > created_at),
  CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"));

CREATE INDEX "sessions_expiry_idx" ON "dbo"."sessions" ("expires_at") ;

CREATE INDEX "sessions_active_user_idx" ON "dbo"."sessions" ("user_id", "expires_at") WHERE revoked_at IS NULL;

CREATE TABLE "dbo"."session_refresh_tokens" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_c25bb23cefd8e77e04f9a1283ef" DEFAULT NEWSEQUENTIALID(),
  "session_id" uniqueidentifier NOT NULL,
  "token_hash" nvarchar(64) NOT NULL,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_6a7fe0753e9e65072359767ce7b" DEFAULT getdate(),
  "expires_at" datetimeoffset NOT NULL,
  "consumed_at" datetimeoffset,
  CONSTRAINT "UQ_0c088f7a31f53d7421702ba7f2e" UNIQUE ("token_hash"),
  CONSTRAINT "refresh_tokens_consumption" CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT "refresh_tokens_expiry" CHECK (expires_at > created_at),
  CONSTRAINT "refresh_tokens_hash_valid" CHECK (LEN(token_hash) = 64 AND token_hash COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%'),
  CONSTRAINT "PK_c25bb23cefd8e77e04f9a1283ef" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "refresh_tokens_one_current_idx" ON "dbo"."session_refresh_tokens" ("session_id") WHERE consumed_at IS NULL;

CREATE INDEX "refresh_tokens_session_idx" ON "dbo"."session_refresh_tokens" ("session_id") ;

CREATE TABLE "dbo"."friendships" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_08af97d0be72942681757f07bc8" DEFAULT NEWSEQUENTIALID(),
  "requester_id" uniqueidentifier NOT NULL,
  "recipient_id" uniqueidentifier NOT NULL,
  "pair_low_id" uniqueidentifier NOT NULL,
  "pair_high_id" uniqueidentifier NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_4864bfab7fad9a34292e12bdb01" DEFAULT 'pending',
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_b5de87b28c4b217eb9668bbfefb" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_74b90b9394204a31dd0b7036044" DEFAULT getdate(),
  CONSTRAINT "friendships_status_valid" CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'removed')),
  CONSTRAINT "friendships_distinct_users" CHECK (requester_id <> recipient_id),
  CONSTRAINT "PK_08af97d0be72942681757f07bc8" PRIMARY KEY ("id"));

CREATE INDEX "friendships_recipient_status_idx" ON "dbo"."friendships" ("recipient_id", "status") ;

CREATE INDEX "friendships_requester_status_idx" ON "dbo"."friendships" ("requester_id", "status") ;

CREATE UNIQUE INDEX "friendships_pair_idx" ON "dbo"."friendships" ("pair_low_id", "pair_high_id") ;

CREATE TABLE "dbo"."conversations" ("client_request_id" uniqueidentifier,
  "creation_fingerprint" nvarchar(64),
  "id" uniqueidentifier NOT NULL CONSTRAINT "DF_ee34f4f7ced4ec8681f26bf04ef" DEFAULT NEWSEQUENTIALID(),
  "background" nvarchar(24) NOT NULL CONSTRAINT "DF_3b35699d109734a2df742b91cb6" DEFAULT 'default',
  "nicknames" nvarchar(max) NOT NULL CONSTRAINT "DF_6de5eeaceb31843767c5ab6f78d" DEFAULT '{}',
  "type" nvarchar(16) NOT NULL,
  "title" nvarchar(200),
  "creator_id" uniqueidentifier NOT NULL,
  "direct_user_low_id" uniqueidentifier,
  "direct_user_high_id" uniqueidentifier,
  "last_message_sequence" bigint NOT NULL CONSTRAINT "DF_5b8eed7778e94eb9519c1d4757a" DEFAULT '0',
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_f0bb90db8338e6dc6c349ece995" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_7018433f850e2836a7d9df1b9d7" DEFAULT getdate(),
  "deleted_at" datetimeoffset,
  CONSTRAINT "conversations_request_shape" CHECK ((type = 'direct' AND client_request_id IS NULL AND creation_fingerprint IS NULL) OR (type = 'group' AND ((client_request_id IS NULL AND creation_fingerprint IS NULL) OR (client_request_id IS NOT NULL AND LEN(creation_fingerprint) = 64 AND creation_fingerprint COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%')))),
  CONSTRAINT "conversations_shape" CHECK ((type = 'direct' AND title IS NULL AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL AND CONVERT(char(36), direct_user_low_id) < CONVERT(char(36), direct_user_high_id) AND creator_id IN (direct_user_low_id, direct_user_high_id)) OR (type = 'group' AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL AND title IS NOT NULL AND LEN(trim(title)) > 0)),
  CONSTRAINT "conversations_sequence_valid" CHECK (last_message_sequence >= 0),
  CONSTRAINT "conversations_type_valid" CHECK (type IN ('direct', 'group')),
  CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"));

CREATE INDEX "conversations_direct_high_idx" ON "dbo"."conversations" ("direct_user_high_id") WHERE type = 'direct';

CREATE INDEX "conversations_creator_idx" ON "dbo"."conversations" ("creator_id") ;

CREATE TABLE "dbo"."messages" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_18325f38ae6de43878487eff986" DEFAULT NEWSEQUENTIALID(),
  "conversation_id" uniqueidentifier NOT NULL,
  "sender_id" uniqueidentifier NOT NULL,
  "client_message_id" uniqueidentifier NOT NULL,
  "sequence" bigint NOT NULL,
  "type" nvarchar(16) NOT NULL CONSTRAINT "DF_87183e91f31c528f4abc1cdc511" DEFAULT 'text',
  "content" nvarchar(max),
  "body" nvarchar(MAX),
  "edited_body" nvarchar(MAX),
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_0777b63da90c27d6ed993dc60b2" DEFAULT getdate(),
  "edited_at" datetimeoffset,
  "deleted_at" datetimeoffset,
  "spam_label" bit,
  "spam_score" real,
  "spam_model" nvarchar(100),
  CONSTRAINT "messages_conversation_sender_id" UNIQUE ("conversation_id",
  "sender_id",
  "id"),
  CONSTRAINT "messages_conversation_id" UNIQUE ("conversation_id",
  "id"),
  CONSTRAINT "messages_conversation_sequence" UNIQUE ("conversation_id",
  "sequence"),
  CONSTRAINT "messages_client_id" UNIQUE ("sender_id",
  "client_message_id"),
  CONSTRAINT "messages_edited_body_state" CHECK ((edited_at IS NULL AND edited_body IS NULL) OR (edited_at IS NOT NULL AND edited_body IS NOT NULL)),
  CONSTRAINT "messages_edited_body_valid" CHECK (edited_body IS NULL OR type = 'text'),
  CONSTRAINT "messages_delete_time" CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT "messages_edit_time" CHECK (edited_at IS NULL OR edited_at >= created_at),
  CONSTRAINT "messages_body_valid" CHECK ((type = 'text' AND body IS NOT NULL) OR type IN ('image', 'file', 'voice', 'location', 'call')),
  CONSTRAINT "messages_type_valid" CHECK (type IN ('text', 'image', 'file', 'voice', 'location', 'call')),
  CONSTRAINT "messages_sequence_valid" CHECK (sequence > 0),
  CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"));

CREATE INDEX "messages_sender_idx" ON "dbo"."messages" ("sender_id") ;

CREATE TABLE "dbo"."conversation_members" ("conversation_id" uniqueidentifier NOT NULL,
  "user_id" uniqueidentifier NOT NULL,
  "role" nvarchar(16) NOT NULL CONSTRAINT "DF_3243767685e8899829984a5ca3e" DEFAULT 'member',
  "last_read_sequence" bigint,
  "cleared_after_sequence" bigint NOT NULL CONSTRAINT "DF_7a75975790987346f907c1453c2" DEFAULT '0',
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_40e369838a7a9373f6a3dafb63d" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_23df93473515cb483e75e428ecf" DEFAULT getdate(),
  CONSTRAINT "members_cleared_sequence" CHECK (cleared_after_sequence >= 0),
  CONSTRAINT "members_read_sequence" CHECK (last_read_sequence IS NULL OR last_read_sequence > 0),
  CONSTRAINT "members_role_valid" CHECK (role IN ('owner', 'admin', 'member')),
  CONSTRAINT "PK_5fa9076068b6f2a26fb793d2439" PRIMARY KEY ("conversation_id",
  "user_id"));

CREATE INDEX "members_user_idx" ON "dbo"."conversation_members" ("user_id", "conversation_id") ;

CREATE TABLE "dbo"."conversation_member_periods" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_5397373ce8d2bf3ada67a5c669c" DEFAULT NEWSEQUENTIALID(),
  "conversation_id" uniqueidentifier NOT NULL,
  "user_id" uniqueidentifier NOT NULL,
  "joined_at" datetimeoffset NOT NULL CONSTRAINT "DF_3415901e4c55bbf46c5a42c654d" DEFAULT getdate(),
  "left_at" datetimeoffset,
  "joined_after_sequence" bigint NOT NULL CONSTRAINT "DF_8678b63556bbdbb4499b5153c43" DEFAULT '0',
  "left_after_sequence" bigint,
  CONSTRAINT "member_period_boundary" CHECK ((left_at IS NULL AND left_after_sequence IS NULL) OR (left_at IS NOT NULL AND left_after_sequence IS NOT NULL AND left_after_sequence >= joined_after_sequence)),
  CONSTRAINT "member_period_times" CHECK (left_at IS NULL OR left_at >= joined_at),
  CONSTRAINT "member_period_join_sequence" CHECK (joined_after_sequence >= 0),
  CONSTRAINT "PK_5397373ce8d2bf3ada67a5c669c" PRIMARY KEY ("id"));

CREATE INDEX "member_periods_active_user_idx" ON "dbo"."conversation_member_periods" ("user_id", "conversation_id") WHERE left_at IS NULL;

CREATE INDEX "member_periods_history_idx" ON "dbo"."conversation_member_periods" ("conversation_id", "user_id", "joined_at") ;

CREATE UNIQUE INDEX "member_periods_one_active_idx" ON "dbo"."conversation_member_periods" ("conversation_id", "user_id") WHERE left_at IS NULL;

CREATE TABLE "dbo"."message_receipts" ("conversation_id" uniqueidentifier NOT NULL,
  "message_id" uniqueidentifier NOT NULL,
  "user_id" uniqueidentifier NOT NULL,
  "delivered_at" datetimeoffset NOT NULL CONSTRAINT "DF_59c5a9d788716bea49233ba16f8" DEFAULT getdate(),
  "read_at" datetimeoffset,
  CONSTRAINT "receipts_read_time" CHECK (read_at IS NULL OR read_at >= delivered_at),
  CONSTRAINT "PK_a2b1046990455e3a62c49c6394b" PRIMARY KEY ("message_id",
  "user_id"));

CREATE INDEX "receipts_member_idx" ON "dbo"."message_receipts" ("conversation_id", "user_id") ;

CREATE TABLE "dbo"."attachments" ("client_request_id" uniqueidentifier NOT NULL,
  "id" uniqueidentifier NOT NULL CONSTRAINT "DF_5e1f050bcff31e3084a1d662412" DEFAULT NEWSEQUENTIALID(),
  "conversation_id" uniqueidentifier NOT NULL,
  "uploader_id" uniqueidentifier NOT NULL,
  "message_id" uniqueidentifier,
  "object_key" nvarchar(850) NOT NULL,
  "file_name" nvarchar(MAX) NOT NULL,
  "mime_type" nvarchar(127) NOT NULL,
  "size" bigint NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_e8cc99b26b14533500b7a6ffaae" DEFAULT 'pending',
  "upload_expires_at" datetimeoffset NOT NULL,
  "completed_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_59ae1036d9869d21146e87a1b3d" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_13c9254f132c350d85c7f72564b" DEFAULT getdate(),
  CONSTRAINT "UQ_2a5b1a5dd03ed69f90533041d3e" UNIQUE ("object_key"),
  CONSTRAINT "attachments_client_request" UNIQUE ("uploader_id",
  "client_request_id"),
  CONSTRAINT "attachments_times" CHECK (upload_expires_at > created_at AND (completed_at IS NULL OR completed_at >= created_at)),
  CONSTRAINT "attachments_completion_state" CHECK ((status = 'pending' AND completed_at IS NULL) OR (status IN ('uploaded', 'attached') AND completed_at IS NOT NULL) OR status IN ('rejected', 'expired')),
  CONSTRAINT "attachments_message_state" CHECK ((status = 'attached' AND message_id IS NOT NULL) OR (status <> 'attached' AND message_id IS NULL)),
  CONSTRAINT "attachments_metadata_valid" CHECK (LEN(trim(object_key)) > 0 AND LEN(trim(file_name)) > 0 AND CHARINDEX('/', mime_type) > 1),
  CONSTRAINT "attachments_size_valid" CHECK (size > 0 AND size <= 104857600),
  CONSTRAINT "attachments_status_valid" CHECK (status IN ('pending', 'uploaded', 'attached', 'rejected', 'expired')),
  CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"));

CREATE INDEX "attachments_pending_expiry_idx" ON "dbo"."attachments" ("upload_expires_at") WHERE status = 'pending';

CREATE INDEX "attachments_message_idx" ON "dbo"."attachments" ("conversation_id", "message_id") ;

CREATE INDEX "attachments_uploader_status_idx" ON "dbo"."attachments" ("uploader_id", "status") ;

CREATE TABLE "dbo"."calls" ("summary_enabled" bit NOT NULL CONSTRAINT "DF_1b78acbe25e4ff5397b64a74575" DEFAULT 0,
  "summary_recorder_id" uniqueidentifier,
  "summary_audio_key" uniqueidentifier,
  "summary_audio_mime" nvarchar(32),
  "summary_payload" nvarchar(MAX),
  "client_request_id" uniqueidentifier NOT NULL,
  "id" uniqueidentifier NOT NULL CONSTRAINT "DF_d9171d91f8dd1a649659f1b6a20" DEFAULT NEWSEQUENTIALID(),
  "conversation_id" uniqueidentifier NOT NULL,
  "initiator_id" uniqueidentifier NOT NULL,
  "room_name" nvarchar(200) NOT NULL,
  "type" nvarchar(16) NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_3449b34195836b85705f2c1ab9c" DEFAULT 'ringing',
  "ring_expires_at" datetimeoffset NOT NULL,
  "started_at" datetimeoffset,
  "ended_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_ec5fd299320e682e951bdb0b896" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_7d62fe9adc0f111bc0d3899ed7f" DEFAULT getdate(),
  CONSTRAINT "UQ_1fb7e21b027015d1e96f17f7326" UNIQUE ("room_name"),
  CONSTRAINT "calls_conversation_id" UNIQUE ("conversation_id",
  "id"),
  CONSTRAINT "calls_client_request" UNIQUE ("initiator_id",
  "client_request_id"),
  CONSTRAINT "calls_times_ordered" CHECK (ring_expires_at > created_at AND (started_at IS NULL OR started_at >= created_at) AND (ended_at IS NULL OR ended_at >= created_at) AND (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at)),
  CONSTRAINT "calls_state_times" CHECK ((status = 'ringing' AND started_at IS NULL AND ended_at IS NULL) OR (status = 'active' AND started_at IS NOT NULL AND ended_at IS NULL) OR (status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL) OR (status IN ('rejected', 'missed', 'cancelled') AND started_at IS NULL AND ended_at IS NOT NULL)),
  CONSTRAINT "calls_room_present" CHECK (LEN(trim(room_name)) > 0),
  CONSTRAINT "calls_status_valid" CHECK (status IN ('ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled')),
  CONSTRAINT "calls_type_valid" CHECK (type IN ('audio', 'video')),
  CONSTRAINT "PK_d9171d91f8dd1a649659f1b6a20" PRIMARY KEY ("id"));

CREATE INDEX "calls_ringing_expiry_idx" ON "dbo"."calls" ("ring_expires_at") WHERE status = 'ringing';

CREATE INDEX "calls_initiator_idx" ON "dbo"."calls" ("initiator_id") ;

CREATE INDEX "calls_conversation_history_idx" ON "dbo"."calls" ("conversation_id", "created_at", "id") ;

CREATE UNIQUE INDEX "calls_one_open_idx" ON "dbo"."calls" ("conversation_id") WHERE status IN ('ringing', 'active');

CREATE TABLE "dbo"."call_participants" ("call_id" uniqueidentifier NOT NULL,
  "user_id" uniqueidentifier NOT NULL,
  "conversation_id" uniqueidentifier NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_7cfd9f898c14367a4e911fa2b13" DEFAULT 'invited',
  "invited_at" datetimeoffset NOT NULL CONSTRAINT "DF_cff4940bb07d4685c523949efd7" DEFAULT getdate(),
  "joined_at" datetimeoffset,
  "left_at" datetimeoffset,
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_ab3149efca6746282bcc8cdfd42" DEFAULT getdate(),
  CONSTRAINT "call_participants_times" CHECK (joined_at IS NULL OR (joined_at >= invited_at AND (left_at IS NULL OR left_at >= joined_at))),
  CONSTRAINT "call_participants_state_times" CHECK ((status IN ('invited', 'accepted', 'rejected', 'missed', 'cancelled') AND joined_at IS NULL AND left_at IS NULL) OR (status = 'joined' AND joined_at IS NOT NULL AND left_at IS NULL) OR (status = 'left' AND joined_at IS NOT NULL AND left_at IS NOT NULL)),
  CONSTRAINT "call_participants_status_valid" CHECK (status IN ('invited', 'accepted', 'joined', 'left', 'rejected', 'missed', 'cancelled')),
  CONSTRAINT "PK_df6450e31039538500fe0452d50" PRIMARY KEY ("call_id",
  "user_id"));

CREATE INDEX "call_participants_member_idx" ON "dbo"."call_participants" ("conversation_id", "user_id") ;

CREATE INDEX "call_participants_user_history_idx" ON "dbo"."call_participants" ("user_id", "invited_at") ;

CREATE TABLE "dbo"."device_tokens" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_84700be257607cfb1f9dc2e52c3" DEFAULT NEWSEQUENTIALID(),
  "user_id" uniqueidentifier NOT NULL,
  "platform" nvarchar(16) NOT NULL,
  "token" nvarchar(850) NOT NULL,
  "revoked_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_4fe8d27cdd3e8a1f2221bc1f1d2" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_4eb64cc84802485f3b6fdfc954d" DEFAULT getdate(),
  CONSTRAINT "UQ_977e24c520c49436d08e5eeea8a" UNIQUE ("token"),
  CONSTRAINT "device_tokens_revocation_time" CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT "device_tokens_token_present" CHECK (LEN(trim(token)) > 0),
  CONSTRAINT "device_tokens_platform_valid" CHECK (platform IN ('web', 'android')),
  CONSTRAINT "device_tokens_token_size" CHECK (DATALENGTH(token) <= 2048),
  CONSTRAINT "PK_84700be257607cfb1f9dc2e52c3" PRIMARY KEY ("id"));

CREATE INDEX "device_tokens_active_user_idx" ON "dbo"."device_tokens" ("user_id") WHERE revoked_at IS NULL;

CREATE TABLE "dbo"."notifications" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_6a72c3c0f683f6462415e653c3a" DEFAULT NEWSEQUENTIALID(),
  "user_id" uniqueidentifier NOT NULL,
  "type" nvarchar(32) NOT NULL,
  "payload" nvarchar(max) NOT NULL CONSTRAINT "DF_224c4fe53a7e8116e51a52c2685" DEFAULT '{}',
  "deduplication_key" nvarchar(200),
  "read_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_77ee7b06d6f802000c0846f3a56" DEFAULT getdate(),
  CONSTRAINT "notifications_dedupe_present" CHECK (deduplication_key IS NULL OR LEN(trim(deduplication_key)) > 0),
  CONSTRAINT "notifications_read_time" CHECK (read_at IS NULL OR read_at >= created_at),
  CONSTRAINT "notifications_payload_valid" CHECK (ISJSON(payload, OBJECT) = 1 AND DATALENGTH(payload) <= 16384),
  CONSTRAINT "notifications_type_valid" CHECK (type IN ('friend_request', 'friend_accepted', 'message', 'call', 'ai_completed', 'ai_failed', 'report_updated')),
  CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"));

CREATE INDEX "notifications_unread_idx" ON "dbo"."notifications" ("user_id", "created_at") WHERE read_at IS NULL;

CREATE INDEX "notifications_user_cursor_idx" ON "dbo"."notifications" ("user_id", "created_at", "id") ;

CREATE TABLE "dbo"."ai_jobs" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_895e59e4adb993a3f45dacb1d6b" DEFAULT NEWSEQUENTIALID(),
  "user_id" uniqueidentifier NOT NULL,
  "client_request_id" uniqueidentifier NOT NULL,
  "conversation_id" uniqueidentifier,
  "kind" nvarchar(32) NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_2a33c0d64247e313579762d183c" DEFAULT 'queued',
  "input_start_sequence" bigint,
  "input_end_sequence" bigint,
  "input" nvarchar(max) NOT NULL CONSTRAINT "DF_abffe17bda2f370efa17bedbbba" DEFAULT '{}',
  "output" nvarchar(MAX),
  "error_code" nvarchar(64),
  "started_at" datetimeoffset,
  "finished_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_924c06217c6a5e45cba70d08873" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_8cf1784d14fb3091e769f53e943" DEFAULT getdate(),
  CONSTRAINT "ai_jobs_client_request" UNIQUE ("user_id",
  "client_request_id"),
  CONSTRAINT "ai_jobs_times" CHECK ((started_at IS NULL OR started_at >= created_at) AND (finished_at IS NULL OR finished_at >= created_at) AND (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at)),
  CONSTRAINT "ai_jobs_state_valid" CHECK ((status = 'queued' AND started_at IS NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND output IS NOT NULL AND error_code IS NULL) OR (status = 'failed' AND finished_at IS NOT NULL AND output IS NULL AND error_code IS NOT NULL) OR (status = 'cancelled' AND finished_at IS NOT NULL AND output IS NULL)),
  CONSTRAINT "ai_jobs_output_size" CHECK (output IS NULL OR DATALENGTH(output) <= 1048576),
  CONSTRAINT "ai_jobs_input_valid" CHECK (ISJSON(input, OBJECT) = 1 AND DATALENGTH(input) <= 65536),
  CONSTRAINT "ai_jobs_range_valid" CHECK ((conversation_id IS NULL AND input_start_sequence IS NULL AND input_end_sequence IS NULL AND kind = 'chat') OR (conversation_id IS NOT NULL AND input_start_sequence IS NOT NULL AND input_end_sequence IS NOT NULL AND input_start_sequence > 0 AND input_end_sequence >= input_start_sequence)),
  CONSTRAINT "ai_jobs_status_valid" CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT "ai_jobs_kind_valid" CHECK (kind IN ('chat', 'summary', 'reply_suggestions')),
  CONSTRAINT "ai_jobs_error_code_valid" CHECK (error_code IS NULL OR LEN(error_code) BETWEEN 1 AND 64 AND error_code COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z0-9_]%'),
  CONSTRAINT "PK_895e59e4adb993a3f45dacb1d6b" PRIMARY KEY ("id"));

CREATE INDEX "ai_jobs_conversation_idx" ON "dbo"."ai_jobs" ("conversation_id") ;

CREATE INDEX "ai_jobs_queue_idx" ON "dbo"."ai_jobs" ("created_at", "id") WHERE status = 'queued';

CREATE INDEX "ai_jobs_user_cursor_idx" ON "dbo"."ai_jobs" ("user_id", "created_at", "id") ;

CREATE TABLE "dbo"."reports" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_d9013193989303580053c0b5ef6" DEFAULT NEWSEQUENTIALID(),
  "reporter_id" uniqueidentifier NOT NULL,
  "target_type" nvarchar(16) NOT NULL,
  "reported_user_id" uniqueidentifier,
  "reported_conversation_id" uniqueidentifier,
  "reported_message_id" uniqueidentifier,
  "reported_call_id" uniqueidentifier,
  "reported_attachment_id" uniqueidentifier,
  "target_id" uniqueidentifier NOT NULL,
  "reason" nvarchar(2000) NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_dab4d78b3be05c1ca4a626f57f7" DEFAULT 'open',
  "reviewer_id" uniqueidentifier,
  "snapshot" nvarchar(max) NOT NULL CONSTRAINT "DF_86c2aefeb8025658189139c3028" DEFAULT '{}',
  "resolution" nvarchar(2000),
  "reviewed_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_dc4079492e338ac5ce4f9a740a0" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_fd92c56e473da3bae8cfd96074f" DEFAULT getdate(),
  CONSTRAINT "reports_review_time" CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CONSTRAINT "reports_review_state" CHECK ((status = 'open' AND reviewer_id IS NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status = 'reviewing' AND reviewer_id IS NOT NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status IN ('resolved', 'dismissed') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution IS NOT NULL AND LEN(trim(resolution)) > 0)),
  CONSTRAINT "reports_reviewer_separate" CHECK (reviewer_id IS NULL OR reviewer_id <> reporter_id),
  CONSTRAINT "reports_snapshot_valid" CHECK (ISJSON(snapshot, OBJECT) = 1 AND DATALENGTH(snapshot) <= 65536),
  CONSTRAINT "reports_reason_present" CHECK (LEN(trim(reason)) > 0),
  CONSTRAINT "reports_status_valid" CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  CONSTRAINT "reports_target_valid" CHECK ((CASE WHEN reported_user_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_conversation_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_message_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_call_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_attachment_id IS NULL THEN 0 ELSE 1 END) = 1 AND ((target_type = 'user' AND reported_user_id IS NOT NULL) OR (target_type = 'conversation' AND reported_conversation_id IS NOT NULL) OR (target_type = 'message' AND reported_message_id IS NOT NULL) OR (target_type = 'call' AND reported_call_id IS NOT NULL) OR (target_type = 'attachment' AND reported_attachment_id IS NOT NULL))),
  CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"));

CREATE INDEX "reports_attachment_target_idx" ON "dbo"."reports" ("reported_attachment_id") ;

CREATE INDEX "reports_call_target_idx" ON "dbo"."reports" ("reported_call_id") ;

CREATE INDEX "reports_message_target_idx" ON "dbo"."reports" ("reported_message_id") ;

CREATE INDEX "reports_conversation_target_idx" ON "dbo"."reports" ("reported_conversation_id") ;

CREATE INDEX "reports_user_target_idx" ON "dbo"."reports" ("reported_user_id") ;

CREATE INDEX "reports_reviewer_idx" ON "dbo"."reports" ("reviewer_id") ;

CREATE INDEX "reports_queue_idx" ON "dbo"."reports" ("status", "created_at", "id") ;

CREATE UNIQUE INDEX "reports_one_open_target_idx" ON "dbo"."reports" ("reporter_id", "target_type", "target_id") WHERE status IN ('open', 'reviewing');

CREATE TABLE "dbo"."audit_logs" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_1bb179d048bbc581caa3b013439" DEFAULT NEWSEQUENTIALID(),
  "actor_id" uniqueidentifier,
  "action" nvarchar(100) NOT NULL,
  "target_type" nvarchar(32),
  "target_id" uniqueidentifier,
  "request_id" uniqueidentifier,
  "metadata" nvarchar(max) NOT NULL CONSTRAINT "DF_b96e8ffa4af788b753fd7bec954" DEFAULT '{}',
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_2cd10fda8276bb995288acfbfb1" DEFAULT getdate(),
  CONSTRAINT "audit_logs_metadata_valid" CHECK (ISJSON(metadata, OBJECT) = 1 AND DATALENGTH(metadata) <= 16384),
  CONSTRAINT "audit_logs_target_pair" CHECK ((target_type IS NULL AND target_id IS NULL) OR (target_type IS NOT NULL AND LEN(trim(target_type)) > 0 AND target_id IS NOT NULL)),
  CONSTRAINT "audit_logs_action_present" CHECK (LEN(trim(action)) > 0),
  CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"));

CREATE INDEX "audit_logs_created_idx" ON "dbo"."audit_logs" ("created_at", "id") ;

CREATE INDEX "audit_logs_target_idx" ON "dbo"."audit_logs" ("target_type", "target_id", "created_at") ;

CREATE INDEX "audit_logs_actor_cursor_idx" ON "dbo"."audit_logs" ("actor_id", "created_at", "id") ;

CREATE TABLE "dbo"."registration_verifications" ("email" nvarchar(254) NOT NULL,
  "challenge_id" uniqueidentifier NOT NULL,
  "code_hash" nvarchar(64) NOT NULL,
  "proof_hash" nvarchar(64),
  "attempts" int NOT NULL CONSTRAINT "DF_db5811c9367ae74bc3dc2b1167d" DEFAULT 0,
  "send_count" int NOT NULL,
  "window_started_at" datetimeoffset NOT NULL,
  "sent_at" datetimeoffset NOT NULL,
  "expires_at" datetimeoffset NOT NULL,
  "verified_at" datetimeoffset,
  "consumed_at" datetimeoffset,
  "delivered" bit NOT NULL CONSTRAINT "DF_ed97da709b1da7b32edc3313f49" DEFAULT 0,
  CONSTRAINT "UQ_8276f5f63d3f5eef16b0f216ec5" UNIQUE ("challenge_id"),
  CONSTRAINT "registration_attempts_valid" CHECK (attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5),
  CONSTRAINT "registration_email_normalized" CHECK (email = lower(trim(email))),
  CONSTRAINT "PK_100b553e919ce4fb8e7f855509d" PRIMARY KEY ("email"));

CREATE TABLE "dbo"."password_resets" ("email" nvarchar(254) NOT NULL,
  "challenge_id" uniqueidentifier NOT NULL,
  "user_id" uniqueidentifier,
  "credential_hash" nvarchar(64),
  "code_hash" nvarchar(64) NOT NULL,
  "attempts" int NOT NULL CONSTRAINT "DF_b1a733dda1c6017a37424a77f85" DEFAULT 0,
  "send_count" int NOT NULL,
  "window_started_at" datetimeoffset NOT NULL,
  "sent_at" datetimeoffset NOT NULL,
  "expires_at" datetimeoffset NOT NULL,
  "consumed_at" datetimeoffset,
  "delivered" bit NOT NULL CONSTRAINT "DF_f354a0528e0a9d7776f3c9c9c32" DEFAULT 0,
  CONSTRAINT "UQ_b05b463adfc3dd7ec74e10f0587" UNIQUE ("challenge_id"),
  CONSTRAINT "password_reset_limits" CHECK (attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5),
  CONSTRAINT "password_reset_email_normalized" CHECK (email = lower(trim(email))),
  CONSTRAINT "PK_7e57f540b334d522f9cf5b16ca5" PRIMARY KEY ("email"));

CREATE TABLE "dbo"."message_requests" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_254cdba4327d6e56ba9580b4df6" DEFAULT NEWSEQUENTIALID(),
  "requester_id" uniqueidentifier NOT NULL,
  "recipient_id" uniqueidentifier NOT NULL,
  "pair_low_id" uniqueidentifier NOT NULL,
  "pair_high_id" uniqueidentifier NOT NULL,
  "body" nvarchar(MAX) NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_421b8593e115ee6d3c9ece8787c" DEFAULT 'pending',
  "responded_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_f80d09656762c478962390006c1" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_d2369f1eb6cb7db11625c65a5b4" DEFAULT getdate(),
  CONSTRAINT "message_requests_body_present" CHECK (LEN(body) > 0),
  CONSTRAINT "message_requests_status_valid" CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT "message_requests_distinct_users" CHECK (requester_id <> recipient_id),
  CONSTRAINT "PK_254cdba4327d6e56ba9580b4df6" PRIMARY KEY ("id"));

CREATE INDEX "message_requests_requester_status_idx" ON "dbo"."message_requests" ("requester_id", "status") ;

CREATE INDEX "message_requests_recipient_status_idx" ON "dbo"."message_requests" ("recipient_id", "status") ;

CREATE UNIQUE INDEX "message_requests_pair_idx" ON "dbo"."message_requests" ("pair_low_id", "pair_high_id") ;

CREATE TABLE "dbo"."game_sessions" ("id" uniqueidentifier NOT NULL CONSTRAINT "DF_e25fa82d55744e55000c3288fdc" DEFAULT NEWSEQUENTIALID(),
  "conversation_id" uniqueidentifier NOT NULL,
  "game_type" nvarchar(24) NOT NULL CONSTRAINT "DF_72da054e3f88a4920e69698cfa6" DEFAULT 'caro',
  "x_user_id" uniqueidentifier NOT NULL,
  "o_user_id" uniqueidentifier NOT NULL,
  "status" nvarchar(16) NOT NULL CONSTRAINT "DF_60e444c386f6177ee2dadc39f0e" DEFAULT 'invited',
  "turn" nvarchar(1) NOT NULL CONSTRAINT "DF_0c617e66e1df27dbd1647e28be7" DEFAULT 'X',
  "board" nvarchar(max) NOT NULL CONSTRAINT "DF_1531b64c567b6769a8440d1c3cb" DEFAULT '[]',
  "winner_id" uniqueidentifier,
  "move_count" int NOT NULL CONSTRAINT "DF_78de842f7dcfac76cd7b2e77e11" DEFAULT 0,
  "finished_at" datetimeoffset,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_4278ae1fd49fdf17d5e1421cccc" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_2e5b984757a40adb8051c99b31f" DEFAULT getdate(),
  CONSTRAINT "game_sessions_winner_valid" CHECK (winner_id IS NULL OR winner_id IN (x_user_id, o_user_id)),
  CONSTRAINT "game_sessions_turn_valid" CHECK (turn IN ('X', 'O')),
  CONSTRAINT "game_sessions_players_distinct" CHECK (x_user_id <> o_user_id),
  CONSTRAINT "game_sessions_status_valid" CHECK (status IN ('invited', 'active', 'won', 'draw', 'declined', 'forfeited')),
  CONSTRAINT "game_sessions_type_valid" CHECK (game_type IN ('caro', 'tic_tac_toe', 'connect_four', 'chess', 'xiangqi', 'othello', 'checkers', 'co_ganh', 'memory_match', 'treasure_hunt', 'rps_showdown', 'pirate_roulette', 'sudoku_duel', 'group_bomb_pass', 'group_truth_dare', 'group_lucky_wheel', 'group_spy_hunt', 'group_heist_vault', 'group_quiz_arena')),
  CONSTRAINT "PK_e25fa82d55744e55000c3288fdc" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "game_sessions_one_open_idx" ON "dbo"."game_sessions" ("conversation_id") WHERE status IN ('invited', 'active');

CREATE INDEX "game_sessions_conversation_idx" ON "dbo"."game_sessions" ("conversation_id", "created_at") ;

CREATE TABLE "dbo"."user_notes" ("user_id" uniqueidentifier NOT NULL,
  "body" nvarchar(80) NOT NULL,
  "music_title" nvarchar(120),
  "music_artist" nvarchar(120),
  "music_url" nvarchar(1000),
  "music_preview_url" nvarchar(1000),
  "expires_at" datetimeoffset NOT NULL,
  "created_at" datetimeoffset NOT NULL CONSTRAINT "DF_ed9a8b44c876d18cfec0b725248" DEFAULT getdate(),
  "updated_at" datetimeoffset NOT NULL CONSTRAINT "DF_6554937b9f5f337923c6c9e5c96" DEFAULT getdate(),
  CONSTRAINT "user_notes_expiry_valid" CHECK (expires_at > created_at),
  CONSTRAINT "user_notes_music_shape" CHECK ((music_title IS NULL AND music_artist IS NULL AND music_url IS NULL AND music_preview_url IS NULL) OR (music_title IS NOT NULL AND LEN(trim(music_title)) BETWEEN 1 AND 120)),
  CONSTRAINT "user_notes_body_present" CHECK (LEN(trim(body)) BETWEEN 1 AND 80),
  CONSTRAINT "PK_d2a9cb672e3701a1f2692c034a4" PRIMARY KEY ("user_id"));

CREATE INDEX "user_notes_expiry_idx" ON "dbo"."user_notes" ("expires_at") ;

CREATE UNIQUE INDEX "conversations_direct_pair" ON dbo.conversations ("direct_user_low_id", "direct_user_high_id") WHERE direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL;

CREATE UNIQUE INDEX "conversations_creator_request" ON dbo.conversations ("creator_id", "client_request_id") WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX "notifications_dedupe" ON dbo.notifications ("user_id", "deduplication_key") WHERE deduplication_key IS NOT NULL;

ALTER TABLE "dbo"."sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."session_refresh_tokens" ADD CONSTRAINT "FK_9a98944e93ad3ef6f091a2d2584" FOREIGN KEY ("session_id") REFERENCES "dbo"."sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "dbo"."friendships" ADD CONSTRAINT "FK_4cf3c68ed4a5a9fde8d4c2b7319" FOREIGN KEY ("requester_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."friendships" ADD CONSTRAINT "FK_721201df6b9dbd63e0f86958cc6" FOREIGN KEY ("recipient_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversations" ADD CONSTRAINT "FK_de27a2f594693a9f00dacfc1cb4" FOREIGN KEY ("creator_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversations" ADD CONSTRAINT "FK_2f6a7b1799eeec2197a9af995f3" FOREIGN KEY ("direct_user_low_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversations" ADD CONSTRAINT "FK_511376f780d97e1890e39e85fdd" FOREIGN KEY ("direct_user_high_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "dbo"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."messages" ADD CONSTRAINT "FK_c25aecf6337abc3a6d02758ec3a" FOREIGN KEY ("conversation_id", "sender_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversation_members" ADD CONSTRAINT "FK_36340a1704b039608e34244511f" FOREIGN KEY ("conversation_id") REFERENCES "dbo"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversation_members" ADD CONSTRAINT "FK_a46c76be8f62c4b00a835cdc370" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversation_members" ADD CONSTRAINT "FK_436b03b64de1db51e75d0de69b4" FOREIGN KEY ("conversation_id", "last_read_sequence") REFERENCES "dbo"."messages"("conversation_id","sequence") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."conversation_member_periods" ADD CONSTRAINT "FK_5483310ea89a86e1df2cc3312e3" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."message_receipts" ADD CONSTRAINT "FK_50d1ce86c77db588d1d5faf05e3" FOREIGN KEY ("conversation_id", "message_id") REFERENCES "dbo"."messages"("conversation_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."message_receipts" ADD CONSTRAINT "FK_38e4eb1f04684d607d0a0ea4589" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."attachments" ADD CONSTRAINT "FK_9c1081ce2fdde6f33ce2105b582" FOREIGN KEY ("conversation_id", "uploader_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."attachments" ADD CONSTRAINT "FK_c7033e9743716f89101ff99ac59" FOREIGN KEY ("conversation_id", "uploader_id", "message_id") REFERENCES "dbo"."messages"("conversation_id","sender_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."calls" ADD CONSTRAINT "FK_f5a258ca31aeacc63b486438727" FOREIGN KEY ("conversation_id", "initiator_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."call_participants" ADD CONSTRAINT "FK_cd9b0f0439537257cce459f37d5" FOREIGN KEY ("conversation_id", "call_id") REFERENCES "dbo"."calls"("conversation_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."call_participants" ADD CONSTRAINT "FK_09e876dbd7b8f12538210cda707" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "dbo"."conversation_members"("conversation_id","user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."device_tokens" ADD CONSTRAINT "FK_17e1f528b993c6d55def4cf5bea" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."notifications" ADD CONSTRAINT "FK_9a8a82462cab47c73d25f49261f" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."ai_jobs" ADD CONSTRAINT "FK_7ee7849fc020f606c147acb4fe1" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."ai_jobs" ADD CONSTRAINT "FK_b7777b63d607e325b4f104df92e" FOREIGN KEY ("conversation_id") REFERENCES "dbo"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."ai_jobs" ADD CONSTRAINT "FK_573251c05bdb5174617669a23a0" FOREIGN KEY ("conversation_id", "input_start_sequence") REFERENCES "dbo"."messages"("conversation_id","sequence") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."ai_jobs" ADD CONSTRAINT "FK_f37e700d10d62016151c4396f39" FOREIGN KEY ("conversation_id", "input_end_sequence") REFERENCES "dbo"."messages"("conversation_id","sequence") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_9459b9bf907a3807ef7143d2ead" FOREIGN KEY ("reporter_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_a9197bd0a7e06bb92648d9efed2" FOREIGN KEY ("reported_user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_9cabb870caed0dde1c6ce8dc7a1" FOREIGN KEY ("reported_conversation_id") REFERENCES "dbo"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_ddab82184f18e5224bae188e724" FOREIGN KEY ("reported_message_id") REFERENCES "dbo"."messages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_3b0079be4e91ff24cfdd10586c7" FOREIGN KEY ("reported_call_id") REFERENCES "dbo"."calls"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_6504d2683f869431c18fc975d60" FOREIGN KEY ("reported_attachment_id") REFERENCES "dbo"."attachments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."reports" ADD CONSTRAINT "FK_8a771ab9cef7da26ac94fb11d92" FOREIGN KEY ("reviewer_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."password_resets" ADD CONSTRAINT "FK_f7a4c3bc48f24df007936d217be" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "dbo"."message_requests" ADD CONSTRAINT "FK_311ea06be12df6afb94fa4b6370" FOREIGN KEY ("requester_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."message_requests" ADD CONSTRAINT "FK_dcfddcc0e6269beb0a129a4a0df" FOREIGN KEY ("recipient_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."game_sessions" ADD CONSTRAINT "FK_c79bff59ebbfa417206acf16f34" FOREIGN KEY ("conversation_id") REFERENCES "dbo"."conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."game_sessions" ADD CONSTRAINT "FK_dfc0614a3af22b5b9ec49e29a9b" FOREIGN KEY ("x_user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."game_sessions" ADD CONSTRAINT "FK_4606706b86f78b57ed1350e1b92" FOREIGN KEY ("o_user_id") REFERENCES "dbo"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "dbo"."user_notes" ADD CONSTRAINT "FK_d2a9cb672e3701a1f2692c034a4" FOREIGN KEY ("user_id") REFERENCES "dbo"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE TABLE dbo.message_pins (
  message_id uniqueidentifier PRIMARY KEY REFERENCES dbo.messages(id) ON DELETE CASCADE,
  conversation_id uniqueidentifier NOT NULL REFERENCES dbo.conversations(id),
  user_id uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  created_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX message_pins_conversation_idx ON dbo.message_pins(conversation_id, created_at);
CREATE TABLE dbo.message_search_index (
  message_id uniqueidentifier PRIMARY KEY REFERENCES dbo.messages(id) ON DELETE CASCADE,
  tokens nvarchar(max) NOT NULL CHECK (ISJSON(tokens, ARRAY) = 1)
);
CREATE TABLE dbo.group_polls (
  id uniqueidentifier PRIMARY KEY DEFAULT NEWID(),
  conversation_id uniqueidentifier NOT NULL REFERENCES dbo.conversations(id),
  creator_id uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  client_request_id uniqueidentifier NOT NULL,
  question nvarchar(max) NOT NULL,
  options nvarchar(max) NOT NULL CHECK (ISJSON(options, ARRAY) = 1),
  multiple bit NOT NULL DEFAULT 0,
  boundary_sequence bigint NOT NULL,
  closed_at datetimeoffset,
  created_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  UNIQUE (creator_id, client_request_id)
);
CREATE INDEX group_polls_conversation_idx ON dbo.group_polls(conversation_id, id);
CREATE TABLE dbo.poll_votes (
  poll_id uniqueidentifier NOT NULL REFERENCES dbo.group_polls(id) ON DELETE CASCADE,
  user_id uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  options nvarchar(max) NOT NULL CHECK (ISJSON(options, ARRAY) = 1),
  PRIMARY KEY (poll_id, user_id)
);
CREATE TABLE dbo.message_reactions (
  conversation_id uniqueidentifier NOT NULL,
  message_id uniqueidentifier NOT NULL,
  user_id uniqueidentifier NOT NULL,
  emoji nvarchar(16) NOT NULL,
  updated_at datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (conversation_id, message_id) REFERENCES dbo.messages(conversation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, user_id) REFERENCES dbo.conversation_members(conversation_id, user_id)
);
CREATE TABLE dbo.user_avatars (
  user_id uniqueidentifier PRIMARY KEY REFERENCES dbo.users(id) ON DELETE CASCADE,
  version uniqueidentifier NOT NULL UNIQUE,
  data varbinary(max) NOT NULL CHECK (DATALENGTH(data) BETWEEN 1 AND 131072)
);
`);
  }
  async down(): Promise<void> {
    throw new Error(
      'Restore a database backup to revert the SQL Server foundation.',
    );
  }
}
