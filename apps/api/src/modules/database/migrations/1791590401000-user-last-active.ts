import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UserLastActive1791590401000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE users ADD COLUMN last_active_at timestamptz',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE users DROP COLUMN last_active_at');
  }
}
