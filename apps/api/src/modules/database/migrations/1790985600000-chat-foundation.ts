import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatFoundation1790985600000 implements MigrationInterface {
  name = 'ChatFoundation1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const database = await queryRunner.getCurrentDatabase();
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(254) NOT NULL, "password_hash" text NOT NULL, "display_name" character varying(100) NOT NULL, "avatar_key" text, "role" character varying(16) NOT NULL DEFAULT 'user', "status" character varying(16) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "users_status_valid" CHECK (status IN ('active', 'blocked', 'deleted')), CONSTRAINT "users_role_valid" CHECK (role IN ('user', 'admin')), CONSTRAINT "users_display_name_present" CHECK (length(btrim(display_name)) > 0), CONSTRAINT "users_password_hash_present" CHECK (length(btrim(password_hash)) > 0), CONSTRAINT "users_email_normalized" CHECK (email = lower(btrim(email)) AND email !~ '[[:space:]]' AND position('@' IN email) > 1), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "device_name" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "sessions_revocation" CHECK (revoked_at IS NULL OR revoked_at >= created_at), CONSTRAINT "sessions_expiry" CHECK (expires_at > created_at), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "sessions_expiry_idx" ON "sessions" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "sessions_active_user_idx" ON "sessions" ("user_id", "expires_at") WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "session_refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "session_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_0c088f7a31f53d7421702ba7f2e" UNIQUE ("token_hash"), CONSTRAINT "refresh_tokens_consumption" CHECK (consumed_at IS NULL OR consumed_at >= created_at), CONSTRAINT "refresh_tokens_expiry" CHECK (expires_at > created_at), CONSTRAINT "refresh_tokens_hash_valid" CHECK (token_hash ~ '^[0-9a-f]{64}$'), CONSTRAINT "PK_c25bb23cefd8e77e04f9a1283ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "refresh_tokens_one_current_idx" ON "session_refresh_tokens" ("session_id") WHERE consumed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_session_idx" ON "session_refresh_tokens" ("session_id") `,
    );
    await queryRunner.query(
      `INSERT INTO "public"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        'public',
        'friendships',
        'GENERATED_COLUMN',
        'pair_low_id',
        'LEAST(requester_id, recipient_id)',
      ],
    );
    await queryRunner.query(
      `INSERT INTO "public"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        database,
        'public',
        'friendships',
        'GENERATED_COLUMN',
        'pair_high_id',
        'GREATEST(requester_id, recipient_id)',
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "friendships" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "requester_id" uuid NOT NULL, "recipient_id" uuid NOT NULL, "pair_low_id" uuid GENERATED ALWAYS AS (LEAST(requester_id, recipient_id)) STORED NOT NULL, "pair_high_id" uuid GENERATED ALWAYS AS (GREATEST(requester_id, recipient_id)) STORED NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "friendships_status_valid" CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'removed')), CONSTRAINT "friendships_distinct_users" CHECK (requester_id <> recipient_id), CONSTRAINT "PK_08af97d0be72942681757f07bc8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "friendships_recipient_status_idx" ON "friendships" ("recipient_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "friendships_requester_status_idx" ON "friendships" ("requester_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "friendships_pair_idx" ON "friendships" ("pair_low_id", "pair_high_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" character varying(16) NOT NULL, "title" character varying(200), "creator_id" uuid NOT NULL, "direct_user_low_id" uuid, "direct_user_high_id" uuid, "last_message_sequence" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "conversations_direct_pair" UNIQUE ("direct_user_low_id", "direct_user_high_id"), CONSTRAINT "conversations_shape" CHECK ((type = 'direct' AND title IS NULL AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL AND direct_user_low_id < direct_user_high_id AND creator_id IN (direct_user_low_id, direct_user_high_id)) OR (type = 'group' AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL AND title IS NOT NULL AND length(btrim(title)) > 0)), CONSTRAINT "conversations_sequence_valid" CHECK (last_message_sequence >= 0), CONSTRAINT "conversations_type_valid" CHECK (type IN ('direct', 'group')), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "conversations_direct_high_idx" ON "conversations" ("direct_user_high_id") WHERE type = 'direct'`,
    );
    await queryRunner.query(
      `CREATE INDEX "conversations_creator_idx" ON "conversations" ("creator_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "sender_id" uuid NOT NULL, "client_message_id" uuid NOT NULL, "sequence" bigint NOT NULL, "type" character varying(16) NOT NULL DEFAULT 'text', "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "edited_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "messages_conversation_id" UNIQUE ("conversation_id", "id"), CONSTRAINT "messages_conversation_sequence" UNIQUE ("conversation_id", "sequence"), CONSTRAINT "messages_client_id" UNIQUE ("sender_id", "client_message_id"), CONSTRAINT "messages_delete_time" CHECK (deleted_at IS NULL OR deleted_at >= created_at), CONSTRAINT "messages_edit_time" CHECK (edited_at IS NULL OR edited_at >= created_at), CONSTRAINT "messages_body_valid" CHECK (length(btrim(body)) > 0 AND char_length(body) <= 10000), CONSTRAINT "messages_type_valid" CHECK (type = 'text'), CONSTRAINT "messages_sequence_valid" CHECK (sequence > 0), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "messages_sender_idx" ON "messages" ("sender_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_members" ("conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(16) NOT NULL DEFAULT 'member', "last_read_sequence" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "members_read_sequence" CHECK (last_read_sequence IS NULL OR last_read_sequence > 0), CONSTRAINT "members_role_valid" CHECK (role IN ('owner', 'admin', 'member')), CONSTRAINT "PK_5fa9076068b6f2a26fb793d2439" PRIMARY KEY ("conversation_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "members_user_idx" ON "conversation_members" ("user_id", "conversation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation_member_periods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "left_at" TIMESTAMP WITH TIME ZONE, "joined_after_sequence" bigint NOT NULL DEFAULT '0', "left_after_sequence" bigint, CONSTRAINT "member_period_boundary" CHECK ((left_at IS NULL AND left_after_sequence IS NULL) OR (left_at IS NOT NULL AND left_after_sequence IS NOT NULL AND left_after_sequence >= joined_after_sequence)), CONSTRAINT "member_period_times" CHECK (left_at IS NULL OR left_at >= joined_at), CONSTRAINT "member_period_join_sequence" CHECK (joined_after_sequence >= 0), CONSTRAINT "PK_5397373ce8d2bf3ada67a5c669c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "member_periods_active_user_idx" ON "conversation_member_periods" ("user_id", "conversation_id") WHERE left_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "member_periods_history_idx" ON "conversation_member_periods" ("conversation_id", "user_id", "joined_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "member_periods_one_active_idx" ON "conversation_member_periods" ("conversation_id", "user_id") WHERE left_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "message_receipts" ("conversation_id" uuid NOT NULL, "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "delivered_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "read_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "receipts_read_time" CHECK (read_at IS NULL OR read_at >= delivered_at), CONSTRAINT "PK_a2b1046990455e3a62c49c6394b" PRIMARY KEY ("message_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "receipts_member_idx" ON "message_receipts" ("conversation_id", "user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_refresh_tokens" ADD CONSTRAINT "FK_9a98944e93ad3ef6f091a2d2584" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "friendships" ADD CONSTRAINT "FK_4cf3c68ed4a5a9fde8d4c2b7319" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "friendships" ADD CONSTRAINT "FK_721201df6b9dbd63e0f86958cc6" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_de27a2f594693a9f00dacfc1cb4" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_2f6a7b1799eeec2197a9af995f3" FOREIGN KEY ("direct_user_low_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_511376f780d97e1890e39e85fdd" FOREIGN KEY ("direct_user_high_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_c25aecf6337abc3a6d02758ec3a" FOREIGN KEY ("conversation_id", "sender_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" ADD CONSTRAINT "FK_36340a1704b039608e34244511f" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" ADD CONSTRAINT "FK_a46c76be8f62c4b00a835cdc370" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" ADD CONSTRAINT "FK_436b03b64de1db51e75d0de69b4" FOREIGN KEY ("conversation_id", "last_read_sequence") REFERENCES "messages"("conversation_id","sequence") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_member_periods" ADD CONSTRAINT "FK_5483310ea89a86e1df2cc3312e3" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_receipts" ADD CONSTRAINT "FK_50d1ce86c77db588d1d5faf05e3" FOREIGN KEY ("conversation_id", "message_id") REFERENCES "messages"("conversation_id","id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_receipts" ADD CONSTRAINT "FK_38e4eb1f04684d607d0a0ea4589" FOREIGN KEY ("conversation_id", "user_id") REFERENCES "conversation_members"("conversation_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // PostgreSQL triggers enforce invariants that decorators cannot express.
    await queryRunner.query(`CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER members_updated_at BEFORE UPDATE ON conversation_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent a third person becoming a member of a direct conversation.
CREATE FUNCTION validate_direct_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  conversation conversations%ROWTYPE;
BEGIN
  SELECT * INTO conversation FROM conversations WHERE id = NEW.conversation_id FOR SHARE;
  IF conversation.type = 'direct' AND NEW.user_id NOT IN (conversation.direct_user_low_id, conversation.direct_user_high_id) THEN
    RAISE EXCEPTION 'Member does not belong to direct conversation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER members_direct_pair BEFORE INSERT OR UPDATE OF conversation_id, user_id ON conversation_members
  FOR EACH ROW EXECUTE FUNCTION validate_direct_member();

-- The direct pair/type is identity, not editable metadata.
CREATE FUNCTION preserve_conversation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.type, NEW.direct_user_low_id, NEW.direct_user_high_id)
    IS DISTINCT FROM ROW(OLD.type, OLD.direct_user_low_id, OLD.direct_user_high_id) THEN
    RAISE EXCEPTION 'Conversation identity cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversations_identity BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION preserve_conversation_identity();
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const database = await queryRunner.getCurrentDatabase();
    await queryRunner.query(
      `ALTER TABLE "message_receipts" DROP CONSTRAINT "FK_38e4eb1f04684d607d0a0ea4589"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_receipts" DROP CONSTRAINT "FK_50d1ce86c77db588d1d5faf05e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_member_periods" DROP CONSTRAINT "FK_5483310ea89a86e1df2cc3312e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" DROP CONSTRAINT "FK_436b03b64de1db51e75d0de69b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" DROP CONSTRAINT "FK_a46c76be8f62c4b00a835cdc370"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_members" DROP CONSTRAINT "FK_36340a1704b039608e34244511f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_c25aecf6337abc3a6d02758ec3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_511376f780d97e1890e39e85fdd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_2f6a7b1799eeec2197a9af995f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_de27a2f594693a9f00dacfc1cb4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "friendships" DROP CONSTRAINT "FK_721201df6b9dbd63e0f86958cc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "friendships" DROP CONSTRAINT "FK_4cf3c68ed4a5a9fde8d4c2b7319"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_refresh_tokens" DROP CONSTRAINT "FK_9a98944e93ad3ef6f091a2d2584"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(`DROP INDEX "public"."receipts_member_idx"`);
    await queryRunner.query(`DROP TABLE "message_receipts"`);
    await queryRunner.query(
      `DROP INDEX "public"."member_periods_one_active_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."member_periods_history_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."member_periods_active_user_idx"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_member_periods"`);
    await queryRunner.query(`DROP INDEX "public"."members_user_idx"`);
    await queryRunner.query(`DROP TABLE "conversation_members"`);
    await queryRunner.query(`DROP INDEX "public"."messages_sender_idx"`);
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(`DROP INDEX "public"."conversations_creator_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."conversations_direct_high_idx"`,
    );
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP INDEX "public"."friendships_pair_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."friendships_requester_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."friendships_recipient_status_idx"`,
    );
    await queryRunner.query(`DROP TABLE "friendships"`);
    await queryRunner.query(
      `DELETE FROM "public"."typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'pair_high_id', database, 'public', 'friendships'],
    );
    await queryRunner.query(
      `DELETE FROM "public"."typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = $3 AND "schema" = $4 AND "table" = $5`,
      ['GENERATED_COLUMN', 'pair_low_id', database, 'public', 'friendships'],
    );
    await queryRunner.query(`DROP INDEX "public"."refresh_tokens_session_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."refresh_tokens_one_current_idx"`,
    );
    await queryRunner.query(`DROP TABLE "session_refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."sessions_active_user_idx"`);
    await queryRunner.query(`DROP INDEX "public"."sessions_expiry_idx"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query('DROP FUNCTION preserve_conversation_identity()');
    await queryRunner.query('DROP FUNCTION validate_direct_member()');
    await queryRunner.query('DROP FUNCTION set_updated_at()');
  }
}
