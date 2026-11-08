import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  decryptMessageText,
  isEncryptedMessageText,
} from '../message-encryption';

type StoredMessage = {
  id: string;
  body: string | null;
  edited_body: string | null;
};

export class MessageEncryption1793664000000 implements MigrationInterface {
  name = 'MessageEncryption1793664000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_body_valid,
      DROP CONSTRAINT messages_edited_body_valid,
      ADD CONSTRAINT messages_body_valid CHECK (
        (type = 'text' AND body IS NOT NULL) OR type IN ('image','file','voice','location','call')),
      ADD CONSTRAINT messages_edited_body_valid CHECK (edited_body IS NULL OR type = 'text')`);

    // Keep this migration compatible with the previous API during blue-green
    // deployment. Existing plaintext is encrypted by the explicit backfill
    // command after traffic has switched to the encryption-aware API.
  }

  async down(runner: QueryRunner): Promise<void> {
    const rows: StoredMessage[] = await runner.query(
      'SELECT id, body, edited_body FROM messages WHERE body IS NOT NULL OR edited_body IS NOT NULL',
    );
    for (const row of rows) {
      await runner.query(
        'UPDATE messages SET body = $2, edited_body = $3 WHERE id = $1',
        [
          row.id,
          row.body !== null && isEncryptedMessageText(row.body)
            ? decryptMessageText(row.body)
            : row.body,
          row.edited_body !== null && isEncryptedMessageText(row.edited_body)
            ? decryptMessageText(row.edited_body)
            : row.edited_body,
        ],
      );
    }
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_body_valid,
      DROP CONSTRAINT messages_edited_body_valid,
      ADD CONSTRAINT messages_body_valid CHECK (
        (type = 'text' AND body IS NOT NULL AND length(btrim(body)) > 0 AND char_length(body) <= 10000)
        OR (type IN ('image','file','voice','location','call') AND (body IS NULL OR char_length(body) <= 10000))),
      ADD CONSTRAINT messages_edited_body_valid CHECK (
        edited_body IS NULL OR (type = 'text' AND length(btrim(edited_body)) > 0 AND char_length(edited_body) <= 10000))`);
  }
}
