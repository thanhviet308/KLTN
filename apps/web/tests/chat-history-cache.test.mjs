import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cachedHistory,
  clearHistoryCache,
  loadRecentHistory,
} from '../src/chat-history-cache.ts';

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
