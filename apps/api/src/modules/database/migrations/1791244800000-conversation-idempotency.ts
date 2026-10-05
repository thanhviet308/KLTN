import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationIdempotency1791244800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE conversations
      ADD COLUMN client_request_id uuid,
      ADD COLUMN creation_fingerprint varchar(64),
      ADD CONSTRAINT conversations_creator_request UNIQUE (creator_id, client_request_id),
      ADD CONSTRAINT conversations_request_shape CHECK (
        (type = 'direct' AND client_request_id IS NULL AND creation_fingerprint IS NULL) OR
        (type = 'group' AND ((client_request_id IS NULL AND creation_fingerprint IS NULL) OR
          (client_request_id IS NOT NULL AND creation_fingerprint ~ '^[0-9a-f]{64}$'))))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE conversations DROP CONSTRAINT conversations_request_shape, DROP CONSTRAINT conversations_creator_request, DROP COLUMN creation_fingerprint, DROP COLUMN client_request_id',
    );
  }
}
