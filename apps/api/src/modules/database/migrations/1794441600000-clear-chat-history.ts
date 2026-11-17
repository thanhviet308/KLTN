import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClearChatHistory1794441600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_members
      ADD COLUMN cleared_after_sequence bigint NOT NULL DEFAULT 0,
      ADD CONSTRAINT members_cleared_sequence CHECK (cleared_after_sequence >= 0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_members
      DROP CONSTRAINT members_cleared_sequence,
      DROP COLUMN cleared_after_sequence`);
  }
}
