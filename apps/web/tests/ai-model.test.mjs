import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  initialSelection,
  sourceRevision,
  sourceVersion,
  textMessages,
  unreadTextMessages,
  UNREAD_SUMMARY_THRESHOLD,
} from '../src/ai-model.ts';

const messages = Array.from({ length: 30 }, (_, index) => ({
  id: `message-${index}`,
  body: `Tin ${index}`,
  type: 'text',
  editedAt: null,
  createdAt: '2026-11-02T00:00:00.000Z',
}));
test('summary defaults to latest 20 texts while reply context stops at its target and translation selects only that target', () => {
  assert.deepEqual(
    initialSelection(messages, 'summary'),
    messages.slice(-20).map((item) => item.id),
  );
  assert.deepEqual(
    initialSelection(messages, 'replies', 'message-15'),
    messages.slice(6, 16).map((item) => item.id),
  );
  assert.deepEqual(initialSelection(messages, 'translate', 'message-15'), [
    'message-15',
  ]);
  assert.deepEqual(initialSelection(messages, 'replies', 'missing'), []);
});
test('media, blank and recalled messages never enter previews or default selections', () => {
  const inputs = [
    messages[0],
    { ...messages[1], type: 'file' },
    { ...messages[2], deletedAt: '2026-11-02' },
    { ...messages[3], body: ' ' },
  ];
  assert.deepEqual(textMessages(inputs), [messages[0]]);
});
test('unread summary selects only incoming text after the frozen read boundary', () => {
  const inputs = [
    { ...messages[0], senderId: 'peer', sequence: '8' },
    { ...messages[1], senderId: 'peer', sequence: '9' },
    { ...messages[2], senderId: 'me', sequence: '10' },
    { ...messages[3], senderId: 'peer', sequence: '11', type: 'file' },
    { ...messages[4], senderId: 'peer', sequence: '12' },
  ];
  assert.equal(UNREAD_SUMMARY_THRESHOLD, 5);
  assert.deepEqual(
    unreadTextMessages(inputs, 'me', '8').map((item) => item.id),
    [messages[1].id, messages[4].id],
  );
});
test('browser revisions match server SHA256 and invalidate results when message content changes', async () => {
  const original = messages[0];
  const digest = createHash('sha256')
    .update(sourceVersion(original))
    .digest('hex');
  assert.equal(await sourceRevision(original), digest);
  assert.notEqual(
    await sourceRevision({ ...original, body: 'Changed' }),
    digest,
  );
  assert.notEqual(
    await sourceRevision({ ...original, editedAt: '2026-11-02T01:00:00.000Z' }),
    digest,
  );
});
