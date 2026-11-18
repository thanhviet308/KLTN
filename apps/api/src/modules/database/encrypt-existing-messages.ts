import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dataSource from './data-source';
import {
  backfillMessageContent,
  encryptMessageBytes,
  encryptMessageText,
  isEncryptedMessageBytes,
  isEncryptedMessageText,
  needsMessageContentEncryption,
} from './message-encryption';

type StoredMessage = {
  id: string;
  body: string | null;
  edited_body: string | null;
};

type StoredMessageContent = {
  id: string;
  content: Record<string, unknown>;
};

const BATCH_SIZE = 500;

async function backfillMessages(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows: StoredMessage[] = await dataSource.query(
      `SELECT id, body, edited_body FROM messages
       WHERE (body IS NOT NULL AND body NOT LIKE 'enc:v1:%')
          OR (edited_body IS NOT NULL AND edited_body NOT LIKE 'enc:v1:%')
       ORDER BY id LIMIT $1`,
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    let progressed = 0;
    for (const row of rows) {
      const body =
        row.body === null || isEncryptedMessageText(row.body)
          ? row.body
          : encryptMessageText(row.body);
      const editedBody =
        row.edited_body === null || isEncryptedMessageText(row.edited_body)
          ? row.edited_body
          : encryptMessageText(row.edited_body);
      const result: { id: string }[] = await dataSource.query(
        `UPDATE messages SET body = $2, edited_body = $3
         WHERE id = $1 AND body IS NOT DISTINCT FROM $4
           AND edited_body IS NOT DISTINCT FROM $5 RETURNING id`,
        [row.id, body, editedBody, row.body, row.edited_body],
      );
      if (result.length) {
        encrypted++;
        progressed++;
      }
    }
    if (!progressed)
      throw new Error('Message encryption backfill made no progress');
  }
  return encrypted;
}

async function backfillMessageContents(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows: StoredMessageContent[] = await dataSource.query(
      `SELECT id, content FROM messages
       WHERE content IS NOT NULL AND (
         (content ? 'fileName' AND COALESCE(content->>'fileName', '') NOT LIKE 'enc:v1:%')
         OR (content #> '{replyTo,excerpt}' IS NOT NULL AND COALESCE(content #>> '{replyTo,excerpt}', '') NOT LIKE 'enc:v1:%')
         OR (jsonb_typeof(content->'latitude') = 'number' AND jsonb_typeof(content->'longitude') = 'number')
       )
       ORDER BY id LIMIT $1`,
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    let progressed = 0;
    for (const row of rows) {
      if (!needsMessageContentEncryption(row.content)) continue;
      const updated = backfillMessageContent(row.content);
      const result: { id: string }[] = await dataSource.query(
        `UPDATE messages SET content = $2::jsonb
         WHERE id = $1 AND content IS NOT DISTINCT FROM $3::jsonb RETURNING id`,
        [row.id, JSON.stringify(updated), JSON.stringify(row.content)],
      );
      if (result.length) {
        encrypted++;
        progressed++;
      }
    }
    if (!progressed)
      throw new Error('Message content encryption backfill made no progress');
  }
  return encrypted;
}

async function backfillAttachments(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows: { id: string; file_name: string }[] = await dataSource.query(
      `SELECT id, file_name FROM attachments
       WHERE file_name NOT LIKE 'enc:v1:%'
       ORDER BY id LIMIT $1`,
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    let progressed = 0;
    for (const row of rows) {
      const next = isEncryptedMessageText(row.file_name)
        ? row.file_name
        : encryptMessageText(row.file_name);
      const result: { id: string }[] = await dataSource.query(
        `UPDATE attachments SET file_name = $2
         WHERE id = $1 AND file_name = $3 RETURNING id`,
        [row.id, next, row.file_name],
      );
      if (result.length) {
        encrypted++;
        progressed++;
      }
    }
    if (!progressed)
      throw new Error('Attachment encryption backfill made no progress');
  }
  return encrypted;
}

async function backfillFiles(): Promise<number> {
  const root = resolve(process.env.CHAT_FILES_DIR ?? 'storage/chat');
  if (!existsSync(root)) return 0;
  const entries = await readdir(root, { withFileTypes: true });
  let encrypted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const filePath = resolve(root, entry.name);
    const bytes = await readFile(filePath);
    if (isEncryptedMessageBytes(bytes)) continue;
    const temporary = `${filePath}.enc-tmp`;
    try {
      await writeFile(temporary, encryptMessageBytes(bytes), { mode: 0o600 });
      await rename(temporary, filePath);
      encrypted++;
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  return encrypted;
}

async function backfill(): Promise<void> {
  await dataSource.initialize();
  try {
    const messageRows = await backfillMessages();
    const contentRows = await backfillMessageContents();
    const attachmentRows = await backfillAttachments();
    const fileCount = await backfillFiles();
    console.log(
      `Encryption backfill complete: ${messageRows} message text row(s), ${contentRows} metadata row(s), ${attachmentRows} attachment row(s), ${fileCount} file(s)`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void backfill().catch((error: unknown) => {
  console.error(
    'Message encryption backfill failed',
    error instanceof Error ? error.message : '',
  );
  process.exitCode = 1;
});
