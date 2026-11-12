import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MoreChatGames1794009600000 implements MigrationInterface {
  name = 'MoreChatGames1794009600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "game_sessions" DROP CONSTRAINT "game_sessions_type_valid"',
    );
    await runner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_type_valid" CHECK (game_type IN ('caro','tic_tac_toe','connect_four'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "game_sessions" DROP CONSTRAINT "game_sessions_type_valid"',
    );
    await runner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_type_valid" CHECK (game_type = 'caro')`,
    );
  }
}
