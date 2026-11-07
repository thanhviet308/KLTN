import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordReset1793577600000 implements MigrationInterface {
  name = 'PasswordReset1793577600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE password_resets (
      email varchar(254) PRIMARY KEY,
      challenge_id uuid NOT NULL UNIQUE,
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      credential_hash varchar(64),
      code_hash varchar(64) NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      send_count integer NOT NULL,
      window_started_at timestamptz NOT NULL,
      sent_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      delivered boolean NOT NULL DEFAULT false,
      CONSTRAINT password_reset_email_normalized CHECK (email = lower(btrim(email))),
      CONSTRAINT password_reset_limits CHECK (attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE password_resets');
  }
}
