import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageRequests1793750400000 implements MigrationInterface {
  name = 'MessageRequests1793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "message_requests" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "requester_id" uuid NOT NULL,
      "recipient_id" uuid NOT NULL,
      "pair_low_id" uuid GENERATED ALWAYS AS (LEAST(requester_id, recipient_id)) STORED NOT NULL,
      "pair_high_id" uuid GENERATED ALWAYS AS (GREATEST(requester_id, recipient_id)) STORED NOT NULL,
      "body" text NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'pending',
      "responded_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_message_requests" PRIMARY KEY ("id"),
      CONSTRAINT "message_requests_distinct_users" CHECK (requester_id <> recipient_id),
      CONSTRAINT "message_requests_status_valid" CHECK (status IN ('pending','accepted','rejected','cancelled')),
      CONSTRAINT "message_requests_body_present" CHECK (length(body) > 0),
      CONSTRAINT "FK_message_requests_requester" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_message_requests_recipient" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "message_requests_pair_idx" ON "message_requests" ("pair_low_id", "pair_high_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "message_requests_recipient_status_idx" ON "message_requests" ("recipient_id", "status")',
    );
    await queryRunner.query(
      'CREATE INDEX "message_requests_requester_status_idx" ON "message_requests" ("requester_id", "status")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "message_requests"');
  }
}
