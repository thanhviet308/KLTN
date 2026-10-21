const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const { ChatGateway } = require('../dist/modules/realtime/chat.gateway');

test('presence only exposes friends and handles multiple devices and expired sessions', async () => {
  const db = {
    query: async () => {},
    getRepository: (entity) => ({
      find: async ({ where }) => {
        if (entity !== Friendship)
          return [
            { id: 'offline', lastActiveAt: new Date('2026-10-08T10:00:00Z') },
          ];
        assert.deepEqual(where, [
          { requesterId: 'me', status: 'accepted' },
          { recipientId: 'me', status: 'accepted' },
        ]);
        return [
          { requesterId: 'me', recipientId: 'friend' },
          { requesterId: 'offline', recipientId: 'me' },
        ];
      },
    }),
  };
  const gateway = new ChatGateway(
    db,
    { authenticate: async () => ({ user: { id: 'me' } }) },
    {},
    {},
    {},
  );
  const connection = (userId, expiresAt = Date.now() + 60000) => ({
    userId,
    expiresAt,
    token: 'test',
    window: Date.now(),
    requests: 0,
    pending: 0,
    rooms: new Set(),
  });
  gateway.connections.set('self', connection('me'));
  gateway.connections.set('tab1', connection('friend'));
  gateway.connections.set('tab2', connection('friend'));
  gateway.connections.set('expired', connection('offline', Date.now() - 1));
  gateway.connections.set('stranger', connection('stranger'));
  gateway.server = {
    sockets: new Map(
      ['self', 'tab1', 'tab2', 'expired', 'stranger'].map((id) => [
        id,
        { connected: true },
      ]),
    ),
  };
  const sync = () => gateway.presence({ id: 'self' }, {});
  assert.deepEqual(await sync(), {
    ok: true,
    data: {
      friend: { online: true, lastActiveAt: null },
      offline: { online: false, lastActiveAt: '2026-10-08T10:00:00.000Z' },
    },
  });
  gateway.handleDisconnect({ id: 'tab1' });
  assert.equal((await sync()).data.friend.online, true);
  gateway.handleDisconnect({ id: 'tab2' });
  assert.equal((await sync()).data.friend.online, false);
});

test('call events reach targeted participants without a conversation subscription', async () => {
  const received = [];
  const auth = { authenticate: async () => ({ user: { id: 'active' } }) };
  const messages = {
    authorizedEvent: async (_userId, _conversationId, _messageId, action) =>
      action(),
  };
  const gateway = new ChatGateway({}, auth, messages, {}, {});
  const connection = (userId) => ({
    userId,
    expiresAt: Date.now() + 60000,
    token: 'test',
    window: Date.now(),
    requests: 0,
    pending: 0,
    rooms: new Set(),
  });
  gateway.connections.set('caller', connection('caller'));
  gateway.connections.set('recipient', connection('recipient'));
  gateway.connections.set('stranger', connection('stranger'));
  gateway.server = {
    adapter: { rooms: new Map() },
    sockets: new Map(
      ['caller', 'recipient', 'stranger'].map((id) => [
        id,
        {
          connected: true,
          emit: (name, payload) => received.push({ id, name, payload }),
        },
      ]),
    ),
  };
  gateway.queue.push({
    name: 'call:incoming',
    actorId: 'caller',
    conversationId: 'conversation',
    targetUserIds: ['recipient'],
    payload: { call: { id: 'call' } },
  });

  await gateway.drain();

  assert.deepEqual(received, [
    {
      id: 'recipient',
      name: 'call:incoming',
      payload: { call: { id: 'call' } },
    },
  ]);
});
