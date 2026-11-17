import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CallSummary1794873600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE calls ADD COLUMN summary_enabled boolean NOT NULL DEFAULT false',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE calls DROP COLUMN summary_enabled');
  }
}
