const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { CallsService } = require('../dist/modules/calls/calls.service');
const { Call } = require('../dist/modules/database/entities/call.entity');
const {
  CallParticipant,
} = require('../dist/modules/database/entities/call-participant.entity');
const {
  Conversation,
} = require('../dist/modules/database/entities/conversation.entity');
const { validateEnvironment } = require('../dist/config/environment');

const baseEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'mssql://app:secret@localhost:1433/chat',
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

test('answering a ringing Android-initiated call on Web claims summaryRecorderId once', async () => {
  const now = new Date();
  const call = {
    id: 'call-1',
    conversationId: 'conv-1',
    initiatorId: 'android-user',
    type: 'audio',
    status: 'ringing',
    summaryEnabled: false,
    summaryRecorderId: null,
    ringExpiresAt: new Date(now.getTime() + 45000),
    startedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const participants = new Map([
    [
      'android-user',
      {
        callId: 'call-1',
        userId: 'android-user',
        status: 'accepted',
        invitedAt: now,
        joinedAt: null,
        leftAt: null,
      },
    ],
    [
      'web-user-1',
      {
        callId: 'call-1',
        userId: 'web-user-1',
        status: 'invited',
        invitedAt: now,
        joinedAt: null,
        leftAt: null,
      },
    ],
    [
      'web-user-2',
      {
        callId: 'call-1',
        userId: 'web-user-2',
        status: 'invited',
        invitedAt: now,
        joinedAt: null,
        leftAt: null,
      },
    ],
  ]);
  const manager = {
    getRepository: (entity) => {
      if (entity === Call) {
        return {
          findOne: async () => call,
          save: async (next) => Object.assign(call, next),
        };
      }
      if (entity === CallParticipant) {
        return {
          findOne: async ({ where }) => participants.get(where.userId) ?? null,
          find: async () => [...participants.values()],
          update: async (where, patch) => {
            const p = participants.get(where.userId);
            if (p && (!where.status || p.status === where.status)) {
              p.status = patch.status;
            }
          },
        };
      }
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
  };
  const service = new CallsService(
    { transaction: async (fn) => fn(manager) },
    { publish: (_name, _actor, payload) => payload },
    { get: () => undefined },
  );

  const first = await service.accept('web-user-1', 'call-1', {
    summaryEnabled: true,
  });
  assert.equal(first.call.status, 'active');
  assert.equal(first.call.summaryEnabled, true);
  assert.equal(first.call.summaryRecorderId, 'web-user-1');

  const second = await service.accept('web-user-2', 'call-1', {
    summaryEnabled: true,
  });
  assert.equal(second.call.summaryEnabled, true);
  assert.equal(second.call.summaryRecorderId, 'web-user-1');
});

test('fallback recorder leaving a group call early disables summary while direct call ending preserves it', async () => {
  const now = new Date();
  function makeScenario(type, remainingJoined) {
    const call = {
      id: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      initiatorId: '33333333-3333-4333-8333-333333333333',
      type: 'audio',
      status: 'active',
      summaryEnabled: true,
      summaryRecorderId: 'web-recorder',
      ringExpiresAt: new Date(now.getTime() + 45000),
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const participant = {
      callId: call.id,
      userId: 'web-recorder',
      status: 'joined',
      invitedAt: now,
      joinedAt: now,
      leftAt: null,
    };
    const manager = {
      query: async () => [{ last_message_sequence: '9' }],
      getRepository: (entity) => {
        if (entity === Call) {
          return {
            findOne: async () => call,
            save: async (next) => Object.assign(call, next),
          };
        }
        if (entity === CallParticipant) {
          return {
            findOne: async () => participant,
            find: async () => [participant],
            save: async (next) => Object.assign(participant, next),
            count: async () => remainingJoined,
            createQueryBuilder: () => ({
              update: () => ({
                set: () => ({
                  where: () => ({
                    andWhere: () => ({ execute: async () => ({}) }),
                  }),
                }),
              }),
            }),
          };
        }
        if (entity === Conversation) {
          return { findOne: async () => ({ id: call.conversationId, type }) };
        }
        if (entity.name === 'Message') {
          return {
            findOneBy: async () => null,
            save: async (msg) => ({
              id: 'msg-1',
              createdAt: now,
              editedAt: null,
              deletedAt: null,
              ...msg,
            }),
          };
        }
        throw new Error(`Unexpected repository: ${entity.name}`);
      },
    };
    const service = new CallsService(
      { transaction: async (fn) => fn(manager) },
      { publish: (_name, _actor, payload) => payload },
      { get: () => undefined },
    );
    return { service };
  }

  const groupEarly = await makeScenario('group', 2).service.leave(
    'web-recorder',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(groupEarly.call.status, 'active');
  assert.equal(groupEarly.call.summaryEnabled, false);
  assert.equal(groupEarly.call.summaryRecorderId, null);

  const directEnd = await makeScenario('direct', 1).service.leave(
    'web-recorder',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(directEnd.call.status, 'ended');
  assert.equal(directEnd.call.summaryEnabled, true);
  assert.equal(directEnd.call.summaryRecorderId, 'web-recorder');
});
