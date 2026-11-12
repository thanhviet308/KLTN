import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandArcadeGames1794096000000 implements MigrationInterface {
  name = 'ExpandArcadeGames1794096000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "game_sessions" ALTER COLUMN "game_type" TYPE varchar(24)',
    );
    await runner.query(
      'ALTER TABLE "game_sessions" DROP CONSTRAINT IF EXISTS "game_sessions_type_valid"',
    );
    await runner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_type_valid" CHECK (game_type IN ('caro','tic_tac_toe','connect_four','chess','xiangqi','othello','checkers','co_ganh','memory_match','treasure_hunt','rps_showdown','pirate_roulette','sudoku_duel','group_bomb_pass','group_truth_dare','group_lucky_wheel','group_spy_hunt','group_heist_vault','group_quiz_arena'))`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE "game_sessions" DROP CONSTRAINT IF EXISTS "game_sessions_type_valid"',
    );
    await runner.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_type_valid" CHECK (game_type IN ('caro','tic_tac_toe','connect_four'))`,
    );
  }
}
