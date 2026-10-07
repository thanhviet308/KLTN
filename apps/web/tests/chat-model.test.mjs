import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMessages } from '../src/chat-model.ts';

const original = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderId: 'user-1',
  clientMessageId: 'request-1',
  sequence: '9007199254740993',
  body: 'Hello',
  createdAt: '2026-10-07T10:00:00Z',
};

test('a delayed history response cannot overwrite a newer edit', () => {
  const edited = {
    ...original,
    body: 'Updated',
    editedAt: '2026-10-07T10:01:00Z',
  };
  assert.deepEqual(mergeMessages([edited], [original]), [edited]);
});

test('a delayed edit cannot restore a deleted message', () => {
  const deleted = {
    ...original,
    body: null,
    deletedAt: '2026-10-07T10:02:00Z',
  };
  const edited = {
    ...original,
    body: 'Updated',
    editedAt: '2026-10-07T10:01:00Z',
  };
  assert.deepEqual(mergeMessages([deleted], [edited]), [deleted]);
});

test('new edits and deletions replace earlier content without duplicating messages', () => {
  const edited = {
    ...original,
    body: 'Updated',
    editedAt: '2026-10-07T10:01:00Z',
  };
  const deleted = { ...edited, body: null, deletedAt: '2026-10-07T10:02:00Z' };
  assert.deepEqual(
    mergeMessages(mergeMessages([original], [edited]), [deleted, deleted]),
    [deleted],
  );
});

test('message order preserves sequence precision beyond JavaScript safe integers', () => {
  const later = { ...original, id: 'message-2', sequence: '9007199254740994' };
  assert.deepEqual(mergeMessages([later], [original]), [original, later]);
});
