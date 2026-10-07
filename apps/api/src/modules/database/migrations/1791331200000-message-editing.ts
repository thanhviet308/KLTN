import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageEditing1791331200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE messages ADD COLUMN edited_body text');
    await runner.query(
      'UPDATE messages SET edited_body = body WHERE edited_at IS NOT NULL',
    );
    // Flush the deferred media-integrity trigger before altering this table.
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency IMMEDIATE',
    );
    await runner.query(`ALTER TABLE messages
      ADD CONSTRAINT messages_edited_body_valid CHECK (edited_body IS NULL OR (type = 'text' AND length(btrim(edited_body)) > 0 AND char_length(edited_body) <= 10000)),
      ADD CONSTRAINT messages_edited_body_state CHECK ((edited_at IS NULL) = (edited_body IS NULL))`);
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency DEFERRED',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    // Preserve the latest text if reverting the extra storage column.
    await runner.query(
      'UPDATE messages SET body = edited_body WHERE edited_body IS NOT NULL',
    );
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency IMMEDIATE',
    );
    await runner.query(
      'ALTER TABLE messages DROP CONSTRAINT messages_edited_body_state, DROP CONSTRAINT messages_edited_body_valid, DROP COLUMN edited_body',
    );
    await runner.query(
      'SET CONSTRAINTS messages_attachment_consistency DEFERRED',
    );
  }
}
