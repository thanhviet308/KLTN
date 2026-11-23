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
  content: string | Record<string, unknown>;
};

const BATCH_SIZE = 500;

async function backfillMessages(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows: StoredMessage[] = await dataSource.query(
      `SELECT TOP (@0) id, body, edited_body FROM messages
       WHERE (body IS NOT NULL AND body NOT LIKE 'enc:v1:%')
          OR (edited_body IS NOT NULL AND edited_body NOT LIKE 'enc:v1:%')
       ORDER BY id`,
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
        `UPDATE messages SET body = @1, edited_body = @2
         OUTPUT INSERTED.id
         WHERE id = @0`,
        [row.id, body, editedBody],
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
  const rows: StoredMessageContent[] = await dataSource.query(
    `SELECT id, content FROM messages WHERE content IS NOT NULL ORDER BY id`,
  );
  for (const row of rows) {
    let parsed: Record<string, unknown> | null = null;
    if (typeof row.content === 'string') {
      try {
        parsed = JSON.parse(row.content) as Record<string, unknown>;
      } catch {
        continue;
      }
    } else if (row.content && typeof row.content === 'object') {
      parsed = row.content;
    }
    if (!parsed || !needsMessageContentEncryption(parsed)) continue;
    const updated = backfillMessageContent(parsed);
    const result: { id: string }[] = await dataSource.query(
      `UPDATE messages SET content = @1
       OUTPUT INSERTED.id
       WHERE id = @0`,
      [row.id, JSON.stringify(updated)],
    );
    if (result.length) {
      encrypted++;
    }
  }
  return encrypted;
}

async function backfillAttachments(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows: { id: string; file_name: string }[] = await dataSource.query(
      `SELECT TOP (@0) id, file_name FROM attachments
       WHERE file_name NOT LIKE 'enc:v1:%'
       ORDER BY id`,
      [BATCH_SIZE],
    );
    if (!rows.length) break;
    let progressed = 0;
    for (const row of rows) {
      const next = isEncryptedMessageText(row.file_name)
        ? row.file_name
        : encryptMessageText(row.file_name);
      const result: { id: string }[] = await dataSource.query(
        `UPDATE attachments SET file_name = @1
         OUTPUT INSERTED.id
         WHERE id = @0 AND file_name = @2`,
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
