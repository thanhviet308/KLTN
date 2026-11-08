import dataSource from './data-source';
import {
  encryptMessageText,
  isEncryptedMessageText,
} from './message-encryption';

type StoredMessage = {
  id: string;
  body: string | null;
  edited_body: string | null;
};

const BATCH_SIZE = 500;

async function backfill(): Promise<void> {
  await dataSource.initialize();
  let encrypted = 0;
  try {
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
      console.log(`Encrypted ${encrypted} existing message row(s)`);
    }
    console.log(`Message encryption backfill complete: ${encrypted} row(s)`);
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
