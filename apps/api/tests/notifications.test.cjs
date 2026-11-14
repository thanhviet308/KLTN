const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  NotificationsService,
} = require('../dist/modules/notifications/notifications.service');
const {
  writeNotification,
} = require('../dist/modules/notifications/notification-writer');

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
  assert.equal(seen.orIgnore, true);
  assert.equal(seen.executed, true);
});
