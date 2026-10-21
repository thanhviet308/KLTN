const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { CallsService } = require('../dist/modules/calls/calls.service');
const { Call } = require('../dist/modules/database/entities/call.entity');
const {
  CallParticipant,
} = require('../dist/modules/database/entities/call-participant.entity');
const { validateEnvironment } = require('../dist/config/environment');

const baseEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:secret@localhost:5432/chat',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
};

test('LiveKit configuration is all-or-none and requires a WebSocket origin', () => {
  assert.throws(
    () =>
      validateEnvironment({ ...baseEnvironment, LIVEKIT_URL: 'wss://test' }),
    /must be configured together/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...baseEnvironment,
        LIVEKIT_URL: 'https://test.livekit.cloud',
        LIVEKIT_API_KEY: 'key',
        LIVEKIT_API_SECRET: 'secret',
      }),
    /WebSocket origin/,
  );
  const environment = validateEnvironment({
    ...baseEnvironment,
    LIVEKIT_URL: 'wss://test.livekit.cloud',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
  });
  assert.equal(environment.LIVEKIT_URL, 'wss://test.livekit.cloud');
});

test('call token is short-lived and scoped to the stored room', async () => {
  const manager = {
    getRepository: (entity) => ({
      findOne: async () => {
        if (entity === Call)
          return {
            id: 'call-id',
            status: 'active',
            roomName: 'server-owned-room',
            type: 'video',
            ringExpiresAt: new Date(Date.now() + 60000),
          };
        if (entity === CallParticipant)
          return { status: 'joined', userId: 'user-id' };
        throw new Error('Unexpected repository');
      },
    }),
  };
  const db = { transaction: async (action) => action(manager) };
  const values = {
    LIVEKIT_URL: 'wss://test.livekit.cloud',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'a-secure-test-secret',
  };
  const service = new CallsService(
    db,
    { publish: () => {} },
    { get: (name) => values[name] },
  );

  const result = await service.token('user-id', 'call-id');
  const claims = JSON.parse(
    Buffer.from(result.token.split('.')[1], 'base64url').toString(),
  );

  assert.equal(result.url, values.LIVEKIT_URL);
  assert.equal(result.callType, 'video');
  assert.equal(claims.sub, 'user-id');
  assert.equal(claims.video.room, 'server-owned-room');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.exp - claims.nbf, 600);
  assert.ok(!result.token.includes(values.LIVEKIT_API_SECRET));
});

test('a terminal call creates one chat history message with duration', async () => {
  const saved = [];
  const manager = {
    getRepository: (entity) => {
      assert.equal(entity.name, 'Message');
      return {
        findOneBy: async () => null,
        save: async (value) => {
          const message = {
            id: 'message-id',
            createdAt: new Date('2026-01-01T00:02:05.000Z'),
            editedAt: null,
            deletedAt: null,
            ...value,
          };
          saved.push(message);
          return message;
        },
      };
    },
    query: async () => [{ last_message_sequence: '8' }],
  };
  const service = new CallsService(
    {},
    { publish: () => {} },
    { get: () => undefined },
  );
  const result = await service.createHistoryMessage(manager, {
    id: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    initiatorId: '33333333-3333-4333-8333-333333333333',
    type: 'video',
    status: 'ended',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:02:05.999Z'),
  });

  assert.equal(saved.length, 1);
  assert.equal(result.type, 'call');
  assert.equal(result.sequence, '8');
  assert.deepEqual(result.content, {
    callId: '11111111-1111-4111-8111-111111111111',
    callType: 'video',
    callStatus: 'ended',
    durationSeconds: 125,
  });
});
