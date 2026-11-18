import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CallSummaryOnDemand1795046400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE calls
      ADD COLUMN summary_audio_key uuid NULL,
      ADD COLUMN summary_audio_mime varchar(32) NULL,
      ADD COLUMN summary_payload text NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE calls
      DROP COLUMN summary_payload,
      DROP COLUMN summary_audio_mime,
      DROP COLUMN summary_audio_key`);
  }
}
