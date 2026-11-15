import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationCustomization1794355200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversations
      ADD COLUMN background varchar(24) NOT NULL DEFAULT 'default',
      ADD COLUMN nicknames jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD CONSTRAINT conversations_background_valid CHECK (background IN ('default', 'ocean', 'mint', 'sunset', 'rose', 'sand')),
      ADD CONSTRAINT conversations_nicknames_object CHECK (jsonb_typeof(nicknames) = 'object')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversations
      DROP CONSTRAINT conversations_nicknames_object,
      DROP CONSTRAINT conversations_background_valid,
      DROP COLUMN nicknames,
      DROP COLUMN background`);
  }
}
