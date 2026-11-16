import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRealtimeErrorDelay,
  extractSocketErrorCode,
} from '../src/lib/realtime-policy.ts';

test('realtime reconnect policy refreshes token on auth failures and backs off on limits', () => {
  assert.deepEqual(classifyRealtimeErrorDelay('AUTH_REQUIRED'), {
    refreshAuth: true,
    delayMs: 1500,
  });
  assert.deepEqual(classifyRealtimeErrorDelay('CONNECTION_LIMIT'), {
    refreshAuth: false,
    delayMs: 5000,
  });
  assert.deepEqual(classifyRealtimeErrorDelay('websocket error'), {
    refreshAuth: false,
    delayMs: 2000,
  });
});

test('extractSocketErrorCode reads gateway data.code before Error message', () => {
  const err = Object.assign(new Error('ORIGIN_FORBIDDEN'), {
    data: { code: 'CONNECTION_LIMIT' },
  });
  assert.equal(extractSocketErrorCode(err), 'CONNECTION_LIMIT');
  assert.equal(
    extractSocketErrorCode(new Error('websocket error')),
    'websocket error',
  );
  assert.equal(extractSocketErrorCode(null), '');
});
