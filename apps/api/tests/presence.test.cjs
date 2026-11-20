const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io } = require('socket.io-client');
require('reflect-metadata');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const { ChatGateway } = require('../dist/modules/realtime/chat.gateway');
const { validateEnvironment } = require('../dist/config/environment');

test('WebSocket namespace accepts configured origins and still enforces authentication', async (t) => {
  const nativeOrigin = 'https://pingpongapi.id.vn';
  const webOrigin = 'https://www.pingpong.id.vn';
  const env = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://app:secret@localhost:5432/chat',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    WEB_ORIGIN: webOrigin,
    REALTIME_NATIVE_ORIGIN: nativeOrigin,
  });
  // Stub account lookup while using the actual Socket.IO transport and middleware.
  const claims = Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 60 }));
  const token = `header.${claims.toString('base64url')}.signature`;
  const gateway = new ChatGateway(
    { query: async () => [] },
    {
      authenticate: async (accessToken) => {
        assert.equal(accessToken, token);
        return { user: { id: 'me' } };
      },
    },
    {},
    { onAccessChange() {}, listen() {}, close() {} },
    { get: (key) => env[key] },
  );
  const http = createServer();
  const server = new Server(http, { transports: ['websocket'] });
  gateway.afterInit(server.of('/chat'));
  t.after(async () => {
    await gateway.onModuleDestroy();
    await server.close();
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const url = `http://127.0.0.1:${http.address().port}/chat`;

  async function connect(origin, accessToken) {
    const client = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 2000,
      extraHeaders: origin === undefined ? {} : { Origin: origin },
      auth: { accessToken },
    });
    try {
      return await new Promise((resolve, reject) => {
        client.once('connect', () => resolve('connected'));
        client.once('connect_error', (error) => {
          if (error.data?.code) resolve(error.data.code);
          else reject(error);
        });
      });
    } finally {
      client.disconnect();
    }
  }

  for (const origin of [nativeOrigin, webOrigin, undefined]) {
    assert.equal(await connect(origin), 'AUTH_REQUIRED');
    assert.equal(await connect(origin, token), 'connected');
  }
  const unrelatedOrigin = 'https://other.example.com';
  assert.equal(await connect(unrelatedOrigin, token), 'ORIGIN_FORBIDDEN');
});

test('realtime native origin configuration requires an exact HTTPS origin', () => {
  const env = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://app:secret@localhost:5432/chat',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
  };
  assert.equal(validateEnvironment(env).REALTIME_NATIVE_ORIGIN, undefined);
  for (const origin of [
    '*',
    'http://pingpongapi.id.vn',
    'https://pingpongapi.id.vn/',
  ]) {
    assert.throws(
      () => validateEnvironment({ ...env, REALTIME_NATIVE_ORIGIN: origin }),
      /REALTIME_NATIVE_ORIGIN must be an exact HTTPS origin/,
    );
  }
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
