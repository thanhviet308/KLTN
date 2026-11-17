import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCachedMessage,
  cachedHistory,
  clearConversationHistoryCache,
  clearHistoryCache,
  loadRecentHistory,
} from '../src/lib/chat-history-cache.ts';

test('preloading and opening a chat share the same in-flight history request', async () => {
  clearHistoryCache();
  let finish;
  let calls = 0;
  const fetchHistory = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const preloaded = loadRecentHistory('user:chat', fetchHistory);
  const opened = loadRecentHistory('user:chat', fetchHistory);
  assert.equal(preloaded, opened);
  finish({ items: [], nextCursor: null, highWatermark: '0' });
  await opened;
  assert.equal(calls, 1);
  assert.deepEqual(cachedHistory('user:chat').messages, []);
});

test('a response arriving after logout cannot restore cached history', async () => {
  clearHistoryCache();
  let finish;
  const request = loadRecentHistory(
    'user:chat',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  clearHistoryCache();
  finish({ items: [], nextCursor: null, highWatermark: '0' });
  await request;
  assert.equal(cachedHistory('user:chat'), undefined);
});

test('descending backward pages are cached chronologically with newest messages last', async () => {
  clearHistoryCache();
  const base = {
    conversationId: 'chat',
    senderId: 'user',
    clientMessageId: 'client',
    createdAt: '2026-10-07T10:00:00Z',
  };
  await loadRecentHistory('user:chat', async () => ({
    items: [
      { ...base, id: 'm3', sequence: '3', body: 'newest' },
      { ...base, id: 'm2', sequence: '2', body: 'middle' },
      { ...base, id: 'm1', sequence: '1', body: 'oldest' },
    ],
    nextCursor: null,
    highWatermark: '3',
  }));
  assert.deepEqual(
    cachedHistory('user:chat').messages.map((m) => m.id),
    ['m1', 'm2', 'm3'],
  );
  applyCachedMessage('user:chat', {
    ...base,
    id: 'm4',
    sequence: '4',
    body: 'incoming',
  });
  assert.deepEqual(
    cachedHistory('user:chat').messages.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4'],
  );
});

test('clearConversationHistoryCache clears only the targeted conversation cache', async () => {
  clearHistoryCache();
  const base = {
    senderId: 'user',
    clientMessageId: 'client',
    createdAt: '2026-10-07T10:00:00Z',
  };
  await loadRecentHistory('user:chat-a', async () => ({
    items: [
      {
        ...base,
        conversationId: 'chat-a',
        id: 'a1',
        sequence: '1',
        body: 'hi',
      },
    ],
    nextCursor: null,
    highWatermark: '1',
  }));
  await loadRecentHistory('user:chat-b', async () => ({
    items: [
      {
        ...base,
        conversationId: 'chat-b',
        id: 'b1',
        sequence: '1',
        body: 'yo',
      },
    ],
    nextCursor: null,
    highWatermark: '1',
  }));
  clearConversationHistoryCache('user:chat-a');
  assert.equal(cachedHistory('user:chat-a'), undefined);
  assert.deepEqual(
    cachedHistory('user:chat-b').messages.map((m) => m.id),
    ['b1'],
  );

  // An in-flight preload started before clearConversationHistoryCache cannot repopulate stale history
  let resolveInFlight;
  const inFlight = loadRecentHistory(
    'user:chat-a',
    () =>
      new Promise((resolve) => {
        resolveInFlight = resolve;
      }),
  );
  clearConversationHistoryCache('user:chat-a');
  resolveInFlight({
    items: [
      {
        ...base,
        conversationId: 'chat-a',
        id: 'stale-1',
        sequence: '1',
        body: 'old',
      },
    ],
    nextCursor: null,
    highWatermark: '1',
  });
  await inFlight;
  assert.equal(cachedHistory('user:chat-a'), undefined);
});
