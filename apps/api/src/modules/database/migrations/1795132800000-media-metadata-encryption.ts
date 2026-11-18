import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  decryptMessageContent,
  decryptMessageText,
  isEncryptedMessageText,
} from '../message-encryption';

export class MediaMetadataEncryption1795132800000 implements MigrationInterface {
  name = 'MediaMetadataEncryption1795132800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE attachments ALTER COLUMN file_name TYPE text',
    );
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_content_valid,
      ADD CONSTRAINT messages_content_valid CHECK (COALESCE((
        (type='text' AND (content IS NULL OR (jsonb_typeof(content)='object' AND octet_length(content::text)<=16384))) OR
        (type IN ('image','file','voice') AND content->>'attachmentId' IS NOT NULL) OR
        (type='location' AND (
          (jsonb_typeof(content->'latitude')='number' AND jsonb_typeof(content->'longitude')='number'
            AND (content->>'latitude')::numeric BETWEEN -90 AND 90 AND (content->>'longitude')::numeric BETWEEN -180 AND 180)
          OR (jsonb_typeof(content->'coordinates')='string' AND length(btrim(content->>'coordinates')) > 0 AND octet_length(content::text)<=16384)
        )) OR
        (type='call' AND content->>'callId' IS NOT NULL AND content->>'callType' IN ('audio','video')
          AND content->>'callStatus' IN ('ended','rejected','missed','cancelled') AND jsonb_typeof(content->'durationSeconds')='number'
          AND (content->>'durationSeconds')::integer>=0)),false))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const messages: { id: string; content: Record<string, unknown> }[] =
      await runner.query(
        'SELECT id, content FROM messages WHERE content IS NOT NULL',
      );
    for (const row of messages) {
      await runner.query(
        'UPDATE messages SET content = $2::jsonb WHERE id = $1',
        [row.id, JSON.stringify(decryptMessageContent(row.content))],
      );
    }
    const attachments: { id: string; file_name: string }[] = await runner.query(
      "SELECT id, file_name FROM attachments WHERE file_name LIKE 'enc:v1:%'",
    );
    for (const row of attachments) {
      if (isEncryptedMessageText(row.file_name)) {
        await runner.query(
          'UPDATE attachments SET file_name = $2 WHERE id = $1',
          [row.id, decryptMessageText(row.file_name).slice(0, 255)],
        );
      }
    }
    await runner.query(`ALTER TABLE messages
      DROP CONSTRAINT messages_content_valid,
      ADD CONSTRAINT messages_content_valid CHECK (COALESCE((
        (type='text' AND (content IS NULL OR (jsonb_typeof(content)='object' AND octet_length(content::text)<=16384))) OR
        (type IN ('image','file','voice') AND content->>'attachmentId' IS NOT NULL) OR
        (type='location' AND jsonb_typeof(content->'latitude')='number' AND jsonb_typeof(content->'longitude')='number'
          AND (content->>'latitude')::numeric BETWEEN -90 AND 90 AND (content->>'longitude')::numeric BETWEEN -180 AND 180) OR
        (type='call' AND content->>'callId' IS NOT NULL AND content->>'callType' IN ('audio','video')
          AND content->>'callStatus' IN ('ended','rejected','missed','cancelled') AND jsonb_typeof(content->'durationSeconds')='number'
          AND (content->>'durationSeconds')::integer>=0)),false))`);
    await runner.query(
      'ALTER TABLE attachments ALTER COLUMN file_name TYPE varchar(255)',
    );
  }
}
