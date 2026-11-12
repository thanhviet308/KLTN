import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SpamDetection1793836800000 implements MigrationInterface {
  name = 'SpamDetection1793836800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE messages
      ADD COLUMN spam_label boolean,
      ADD COLUMN spam_score real,
      ADD COLUMN spam_model varchar(100),
      ADD CONSTRAINT messages_spam_score_valid CHECK (spam_score IS NULL OR (spam_score >= 0 AND spam_score <= 1)),
      ADD CONSTRAINT messages_spam_result_complete CHECK (
        (spam_label IS NULL AND spam_score IS NULL AND spam_model IS NULL) OR
        (spam_label IS NOT NULL AND spam_score IS NOT NULL AND spam_model IS NOT NULL)
      )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_spam_result_complete,
      DROP CONSTRAINT messages_spam_score_valid,
      DROP COLUMN spam_model,
      DROP COLUMN spam_score,
      DROP COLUMN spam_label`);
  }
}
