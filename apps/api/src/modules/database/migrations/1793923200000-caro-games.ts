import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CaroGames1793923200000 implements MigrationInterface {
  name = 'CaroGames1793923200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "game_sessions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "conversation_id" uuid NOT NULL,
      "game_type" varchar(16) NOT NULL DEFAULT 'caro',
      "x_user_id" uuid NOT NULL,
      "o_user_id" uuid NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'invited',
      "turn" varchar(1) NOT NULL DEFAULT 'X',
      "board" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "winner_id" uuid,
      "move_count" integer NOT NULL DEFAULT 0,
      "finished_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "game_sessions_type_valid" CHECK (game_type = 'caro'),
      CONSTRAINT "game_sessions_status_valid" CHECK (status IN ('invited','active','won','draw','declined','forfeited')),
      CONSTRAINT "game_sessions_players_distinct" CHECK (x_user_id <> o_user_id),
      CONSTRAINT "game_sessions_turn_valid" CHECK (turn IN ('X','O')),
      CONSTRAINT "game_sessions_winner_valid" CHECK (winner_id IS NULL OR winner_id IN (x_user_id, o_user_id)),
      CONSTRAINT "PK_game_sessions" PRIMARY KEY (id),
      CONSTRAINT "FK_game_conversation" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT,
      CONSTRAINT "FK_game_x_user" FOREIGN KEY (x_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT "FK_game_o_user" FOREIGN KEY (o_user_id) REFERENCES users(id) ON DELETE RESTRICT
    )`);
    await runner.query(
      'CREATE INDEX "game_sessions_conversation_idx" ON "game_sessions" ("conversation_id", "created_at")',
    );
    await runner.query(
      `CREATE UNIQUE INDEX "game_sessions_one_open_idx" ON "game_sessions" ("conversation_id") WHERE status IN ('invited','active')`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "game_sessions"');
  }
}
