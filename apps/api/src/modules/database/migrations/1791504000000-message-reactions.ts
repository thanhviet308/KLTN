import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageReactions1791504000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE message_reactions (
      conversation_id uuid NOT NULL,
      message_id uuid NOT NULL,
      user_id uuid NOT NULL,
      emoji varchar(16) NOT NULL CHECK (emoji IN ('👍','❤️','😂','😮','😢','😡')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (conversation_id, message_id) REFERENCES messages(conversation_id, id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id, user_id) REFERENCES conversation_members(conversation_id, user_id) ON DELETE RESTRICT
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE message_reactions');
  }
}
