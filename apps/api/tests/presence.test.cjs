const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const { ChatGateway } = require('../dist/modules/realtime/chat.gateway');

test('realtime allows the native API origin and still requires a token', async () => {
  const config = {
    get: (key) =>
      ({ WEB_ORIGIN: 'https://app.example.com', TRUST_PROXY: true })[key],
  };
  const gateway = new ChatGateway({}, {}, {}, {}, config);
  const connect = (origin) =>
    gateway.connect({
      request: { socket: {} },
      handshake: {
        headers: {
          origin,
          host: 'api.example.com',
          'x-forwarded-proto': 'https',
        },
        query: {},
        auth: {},
      },
    });
  for (const origin of [
    undefined,
    'https://app.example.com',
    'https://api.example.com',
  ]) {
    await assert.rejects(connect(origin), {
      response: { code: 'AUTH_REQUIRED', message: 'Access token is required' },
    });
  }
  await assert.rejects(connect('https://other.example.com'), {
    response: { code: 'ORIGIN_FORBIDDEN', message: 'Origin is not allowed' },
  });
});

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

test('new message reaches an authorized inbox without subscription and never reaches outsiders', async () => {
  const received = [];
  const checked = [];
  const gateway = new ChatGateway(
    {},
    { authenticate: async () => ({}) },
    {
      authorizedEvent: async (userId, _conversationId, _messageId, action) => {
        checked.push(userId);
        if (userId === 'recipient') await action();
      },
    },
    {},
    {},
  );
  for (const id of ['recipient', 'outsider'])
    gateway.connections.set(id, {
      userId: id,
      token: 'test',
      rooms: new Set(),
      expiresAt: Date.now() + 60000,
    });
  gateway.server = {
    adapter: { rooms: new Map() },
    sockets: new Map(
      ['recipient', 'outsider'].map((id) => [
        id,
        { connected: true, emit: (name) => received.push({ id, name }) },
      ]),
    ),
  };
  gateway.queue.push({
    name: 'message:created',
    conversationId: 'new-conversation',
    messageId: 'message',
    payload: { id: 'message' },
  });
  await gateway.drain();
  assert.deepEqual(checked.sort(), ['outsider', 'recipient']);
  assert.deepEqual(received, [{ id: 'recipient', name: 'message:created' }]);
});

test('connect, disconnect, rapid reconnect, and friendship changes push realtime presence updates only to friends', async () => {
  const emitted = [];
  let pendingTouchResolve = null;
  const db = {
    query: async (sql) => {
      if (sql.includes('UPDATE users SET last_active_at')) {
        if (pendingTouchResolve) {
          await new Promise((resolve) => {
            const release = pendingTouchResolve;
            pendingTouchResolve = () => {
              release();
              resolve();
            };
          });
        }
        return [];
      }
      if (sql.includes('FROM friendships')) {
        return [{ friend_id: 'friend' }];
      }
      return [];
    },
  };
  const gateway = new ChatGateway(db, {}, {}, {}, {});
  const makeConn = (userId) => ({
    userId,
    expiresAt: Date.now() + 60000,
    token: 'test',
    window: Date.now(),
    requests: 0,
    pending: 0,
    rooms: new Set(),
  });
  const sockets = new Map([
    [
      'friend-sock',
      {
        connected: true,
        emit: (name, payload) => emitted.push({ to: 'friend', name, payload }),
      },
    ],
    [
      'stranger-sock',
      {
        connected: true,
        emit: (name, payload) =>
          emitted.push({ to: 'stranger', name, payload }),
      },
    ],
    [
      'me-tab-1',
      {
        connected: true,
        emit: (name, payload) => emitted.push({ to: 'me', name, payload }),
      },
    ],
    [
      'me-tab-2',
      {
        connected: true,
        emit: (name, payload) => emitted.push({ to: 'me', name, payload }),
      },
    ],
  ]);
  gateway.server = { sockets };
  gateway.connections.set('friend-sock', makeConn('friend'));
  gateway.connections.set('stranger-sock', makeConn('stranger'));

  gateway.connections.set('me-tab-1', makeConn('me'));
  gateway.handleConnection({ id: 'me-tab-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(emitted, [
    {
      to: 'friend',
      name: 'presence:update',
      payload: { userId: 'me', online: true },
    },
  ]);

  emitted.length = 0;
  gateway.connections.set('me-tab-2', makeConn('me'));
  gateway.handleConnection({ id: 'me-tab-2' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.length, 0);

  gateway.handleDisconnect({ id: 'me-tab-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.length, 0);

  // Rapid reconnect while touchActivity is still running must not emit stale offline.
  pendingTouchResolve = () => {};
  gateway.handleDisconnect({ id: 'me-tab-2' });
  gateway.connections.set('me-tab-1', makeConn('me'));
  pendingTouchResolve();
  pendingTouchResolve = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.length, 0);

  // Final disconnect pushes online: false with lastActiveAt to accepted friends only.
  gateway.handleDisconnect({ id: 'me-tab-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].to, 'friend');
  assert.equal(emitted[0].name, 'presence:update');
  assert.equal(emitted[0].payload.userId, 'me');
  assert.equal(emitted[0].payload.online, false);
  assert.match(emitted[0].payload.lastActiveAt, /^\d{4}-\d{2}-\d{2}T/);

  // Accepting friendship pushes immediate friends:updated + presence:update.
  emitted.length = 0;
  gateway.connections.set('me-tab-1', makeConn('me'));
  gateway.handleFriendshipChange('me', 'friend', 'accepted');
  assert.deepEqual(emitted, [
    {
      to: 'me',
      name: 'friends:updated',
      payload: { peerId: 'friend', status: 'accepted' },
    },
    {
      to: 'friend',
      name: 'friends:updated',
      payload: { peerId: 'me', status: 'accepted' },
    },
    {
      to: 'friend',
      name: 'presence:update',
      payload: { userId: 'me', online: true },
    },
    {
      to: 'me',
      name: 'presence:update',
      payload: { userId: 'friend', online: true },
    },
  ]);
});
