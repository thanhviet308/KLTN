import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RegistrationVerification1791158400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE registration_verifications (
      email varchar(254) PRIMARY KEY,
      challenge_id uuid NOT NULL UNIQUE,
      code_hash varchar(64) NOT NULL,
      proof_hash varchar(64),
      attempts integer NOT NULL DEFAULT 0,
      send_count integer NOT NULL,
      window_started_at timestamptz NOT NULL,
      sent_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      verified_at timestamptz,
      consumed_at timestamptz,
      delivered boolean NOT NULL DEFAULT false,
      CONSTRAINT registration_email_normalized CHECK (email = lower(btrim(email))),
      CONSTRAINT registration_attempts_valid CHECK (attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5)
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE registration_verifications');
  }
}
