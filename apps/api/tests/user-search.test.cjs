const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { UsersService } = require('../dist/modules/users/users.service');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');

test('search reports friendship status in both directions and preserves pagination', async () => {
  const peers = [
    'friend1',
    'friend2',
    'outgoing',
    'incoming',
    'removed',
    'rejected',
    'cancelled',
    'stranger',
  ];
  const relationships = [
    { requesterId: 'me', recipientId: 'friend1', status: 'accepted' },
    { requesterId: 'friend2', recipientId: 'me', status: 'accepted' },
    { requesterId: 'me', recipientId: 'outgoing', status: 'pending' },
    { requesterId: 'incoming', recipientId: 'me', status: 'pending' },
    ...['removed', 'rejected', 'cancelled'].map((status) => ({
      requesterId: 'me',
      recipientId: status,
      status,
    })),
  ];
  const query = {};
  for (const method of ['select', 'where', 'andWhere', 'orderBy', 'take'])
    query[method] = () => query;
  query.getMany = async () =>
    [...peers, 'next'].map((id) => ({ id, displayName: id, avatarKey: null }));
  let lookups = 0;
  const service = new UsersService({
    createQueryBuilder: () => query,
    manager: {
      getRepository: (entity) => {
        assert.equal(entity, Friendship);
        return {
          find: async ({ where }) => {
            lookups++;
            assert.equal(where[0].requesterId, 'me');
            assert.equal(where[1].recipientId, 'me');
            assert.deepEqual(where[0].recipientId.value, peers);
            assert.deepEqual(where[1].requesterId.value, peers);
            return relationships;
          },
        };
      },
    },
  });
  const page = await service.search('me', { query: 'việt', limit: 8 });
  assert.equal(lookups, 1);
  assert.equal(page.nextCursor, 'stranger');
  assert.deepEqual(
    page.items.map((item) => item.friendshipStatus),
    [
      'friends',
      'friends',
      'outgoing',
      'incoming',
      'none',
      'none',
      'none',
      'none',
    ],
  );
  assert.equal(page.items[0].displayName, 'friend1');
  query.getMany = async () => [];
  assert.deepEqual(await service.search('me', { query: 'absent', limit: 8 }), {
    items: [],
    nextCursor: null,
  });
  assert.equal(lookups, 1);
});
