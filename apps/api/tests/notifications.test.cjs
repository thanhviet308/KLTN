const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  NotificationsService,
} = require('../dist/modules/notifications/notifications.service');
const {
  writeNotification,
} = require('../dist/modules/notifications/notification-writer');
const { User } = require('../dist/modules/database/entities/user.entity');

function fixture() {
  const seen = {};
  const builder = {};
  for (const name of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'take',
    'set',
    'values',
  ])
    builder[name] = (...args) => {
      seen[name] = args;
      return builder;
    };
  for (const name of ['update', 'insert', 'orIgnore'])
    builder[name] = () => {
      seen[name] = true;
      return builder;
    };
  builder.execute = async () => {
    seen.executed = true;
  };
  builder.getMany = async () => [{ id: 'new' }, { id: 'old' }];
  const repository = {
    createQueryBuilder: () => builder,
    findOne: async ({ where }) =>
      seen.values?.find(
        (n) =>
          n.userId === where.userId &&
          n.deduplicationKey === where.deduplicationKey,
      ),
    insert: async (value) => (seen.values ??= []).push(value),
    countBy: async (criteria) => {
      seen.count = criteria;
      return 3;
    },
    findOneBy: async (criteria) => {
      seen.cursor = criteria;
      return null;
    },
    existsBy: async (criteria) => {
      seen.owner = criteria;
      return criteria.userId === 'owner';
    },
  };
  const db = { getRepository: () => repository };
  return { service: new NotificationsService(db), db, seen };
}

test('notifications are scoped to the signed-in user and paginated newest first', async () => {
  const { service, seen } = fixture();
  const page = await service.list('owner', { limit: 1 });
  assert.deepEqual(page, {
    items: [{ id: 'new' }],
    nextCursor: 'new',
    unreadCount: 3,
  });
  assert.equal(seen.where[1].userId, 'owner');
  assert.equal(seen.count.userId, 'owner');
  assert.deepEqual(seen.orderBy, ['notification.createdAt', 'DESC']);
  assert.deepEqual(seen.addOrderBy, ['notification.id', 'DESC']);
});
test('foreign cursors and attempts to mark another user notification are rejected', async () => {
  const { service, seen } = fixture();
  await assert.rejects(
    service.list('other', { limit: 20, cursor: 'private' }),
    (error) => error.getStatus() === 400,
  );
  assert.deepEqual(seen.cursor, { id: 'private', userId: 'other' });
  await assert.rejects(
    service.read('other', 'private'),
    (error) => error.getStatus() === 404,
  );
  assert.equal(seen.executed, undefined);
});
test('read actions only update unread records owned by the user', async () => {
  const { service, seen } = fixture();
  await service.read('owner', 'notice');
  assert.equal(seen.where[0].id, 'notice');
  assert.equal(seen.where[0].userId, 'owner');
  assert.equal(seen.where[0].readAt._type, 'isNull');
  await service.read('owner');
  assert.equal(seen.where[0].id, undefined);
  assert.equal(seen.where[0].userId, 'owner');
});
test('event notifications use the supplied transaction and a deduplication key', async () => {
  const { db, seen } = fixture();
  await writeNotification(
    db,
    'recipient',
    'friend_request',
    { title: 'Invitation' },
    'request:123',
  );
  assert.deepEqual(seen.values[0], {
    userId: 'recipient',
    type: 'friend_request',
    payload: { title: 'Invitation' },
    deduplicationKey: 'request:123',
  });
  await writeNotification(
    db,
    'recipient',
    'friend_request',
    { title: 'Invitation' },
    'request:123',
  );
  assert.equal(seen.values.length, 1);
});
test('notification lists hydrate actor profiles for historical and current events', async () => {
  const rows = [
    {
      id: 'n1',
      type: 'friend_request',
      payload: {
        title: 'Bạn có lời mời kết bạn mới',
        requesterId: 'u1',
        requestId: 'req-1',
      },
      createdAt: new Date('2026-11-15T10:00:00Z'),
      readAt: null,
    },
    {
      id: 'n2',
      type: 'friend_accepted',
      payload: {
        title: 'Lời mời kết bạn đã được chấp nhận',
        userId: 'u2',
      },
      createdAt: new Date('2026-11-15T09:00:00Z'),
      readAt: null,
    },
    {
      id: 'n3',
      type: 'friend_request',
      payload: {
        title: 'Bạn có lời mời kết bạn mới',
        requesterId: 'missing-user',
      },
      createdAt: new Date('2026-11-15T08:00:00Z'),
      readAt: null,
    },
  ];
  let userQueryArgs = null;
  const noticeRepo = {
    createQueryBuilder: () => {
      const b = {
        where: () => b,
        andWhere: () => b,
        orderBy: () => b,
        addOrderBy: () => b,
        take: () => b,
        getMany: async () => rows,
      };
      return b;
    },
    countBy: async () => 2,
  };
  const userRepo = {
    createQueryBuilder: () => {
      const b = {
        where: (...args) => {
          userQueryArgs = args;
          return b;
        },
        getMany: async () => [
          {
            id: 'u1',
            displayName: 'Bảo Trân',
            avatarKey: '/users/avatars/u1.jpg',
            email: 'secret@example.com',
          },
          {
            id: 'u2',
            displayName: 'Minh Anh',
            avatarKey: null,
            email: 'secret2@example.com',
          },
        ],
      };
      return b;
    },
  };
  const service = new NotificationsService({
    getRepository: (entity) => (entity === User ? userRepo : noticeRepo),
  });
  const result = await service.list('owner', { limit: 20 });
  assert.deepEqual(userQueryArgs[1].ids, ['u1', 'u2', 'missing-user']);
  assert.deepEqual(result.items[0].actor, {
    id: 'u1',
    displayName: 'Bảo Trân',
    avatarUrl: '/users/avatars/u1.jpg',
  });
  assert.deepEqual(result.items[1].actor, {
    id: 'u2',
    displayName: 'Minh Anh',
    avatarUrl: null,
  });
  assert.equal(result.items[2].actor, undefined);
});
