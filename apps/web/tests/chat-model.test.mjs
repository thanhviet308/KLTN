import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReplyDraftSummary,
  extractMessageReply,
  mergeMessages,
  messageSummary,
  newestMessagesFirst,
} from '../src/lib/chat-model.ts';

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

test('shared media lists put the newest message first', () => {
  const newest = {
    ...original,
    id: 'message-3',
    sequence: '9007199254740995',
  };
  const middle = {
    ...original,
    id: 'message-2',
    sequence: '9007199254740994',
  };
  assert.deepEqual(newestMessagesFirst([middle, newest, original]), [
    newest,
    middle,
    original,
  ]);
});

test('structured and legacy replies separate quoted metadata from reply body cleanly', () => {
  const structured = {
    ...original,
    body: 'Sao thế?',
    content: {
      replyTo: {
        messageId: 'voice-1',
        senderId: 'user-2',
        type: 'voice',
        excerpt: 'Tin nhắn thoại',
      },
    },
  };
  assert.deepEqual(extractMessageReply(structured), {
    reply: structured.content.replyTo,
    body: 'Sao thế?',
  });
  assert.equal(messageSummary(structured), 'Sao thế?');

  const legacyEmptyQuote = {
    ...original,
    body: '> Bảo Trân: \n\nlà sao',
  };
  assert.deepEqual(extractMessageReply(legacyEmptyQuote), {
    reply: {
      legacySenderName: 'Bảo Trân',
      type: 'text',
      excerpt: 'Tin nhắn đã trích dẫn',
    },
    body: 'là sao',
  });
  assert.equal(messageSummary(legacyEmptyQuote), 'là sao');

  const voiceOriginal = {
    ...original,
    id: 'voice-1',
    type: 'voice',
    body: null,
  };
  assert.deepEqual(buildReplyDraftSummary(voiceOriginal), {
    messageId: 'voice-1',
    senderId: 'user-1',
    type: 'voice',
    excerpt: 'Tin nhắn thoại',
  });
});
