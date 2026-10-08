import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UserAvatars1791590400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE user_avatars (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      version uuid NOT NULL UNIQUE,
      data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 131072)
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "UPDATE users SET avatar_key = NULL WHERE avatar_key LIKE '/users/avatars/%'",
    );
    await runner.query('DROP TABLE user_avatars');
  }
}
