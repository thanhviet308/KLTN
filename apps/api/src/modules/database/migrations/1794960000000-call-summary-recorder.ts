import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CallSummaryRecorder1794960000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE calls ADD COLUMN summary_recorder_id uuid NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE calls DROP COLUMN summary_recorder_id',
    );
  }
}
