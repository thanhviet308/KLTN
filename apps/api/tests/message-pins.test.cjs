const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  WorkspaceService,
} = require('../dist/modules/workspace/workspace.service');

function fixture(type = 'direct', denied = false) {
  const queries = [];
  const events = [];
  let committed = false;
  const manager = {
    query: async (sql, args) => {
      queries.push({ sql, args });
      if (sql.includes('count(*)')) return [{ total: 0 }];
      return [];
    },
  };
  const db = {
    transaction: async (fn) => {
      const result = await fn(manager);
      committed = true;
      return result;
    },
    query: manager.query,
  };
  const conversations = {
    requireAccess: async (_, id, actor) => {
      if (denied || !['alice', 'bob'].includes(actor))
        throw new Error('forbidden');
      return { conversation: { type } };
    },
  };
  const messages = {
    get: async () => ({ message: { id: 'message', body: 'hello' } }),
  };
  return {
    service: new WorkspaceService(db, conversations, messages, {
      publish: (event) => {
        assert.equal(committed, true);
        events.push(event);
      },
    }),
    queries,
    events,
  };
}
for (const type of ['direct', 'group']) {
  for (const actor of ['alice', 'bob']) {
    test(`${type}: ${actor} can pin and unpin`, async () => {
      const { service, queries, events } = fixture(type);
      assert.deepEqual(
        await service.pin(actor, 'conversation', 'message', false),
        { success: true },
      );
      assert.deepEqual(queries.find((q) => q.sql.startsWith('INSERT')).args, [
        'message',
        'conversation',
        actor,
      ]);
      assert.deepEqual(
        await service.pin(actor, 'conversation', 'message', true),
        { success: true },
      );
      assert.equal(events.length, 2);
      assert.deepEqual(events[0], {
        name: 'conversation:pins',
        conversationId: 'conversation',
        payload: { conversationId: 'conversation' },
      });
      assert.deepEqual(queries.find((q) => q.sql.startsWith('DELETE')).args, [
        'message',
        'conversation',
      ]);
    });
  }
}
test('non-members cannot pin or unpin', async () => {
  const { service, queries } = fixture('direct', true);
  for (const remove of [false, true]) {
    await assert.rejects(
      service.pin('outsider', 'conversation', 'message', remove),
      /forbidden/,
    );
  }
  assert.equal(queries.length, 0);
});
test('direct conversation pins can be listed', async () => {
  const { service, queries } = fixture();
  assert.deepEqual(await service.pins('alice', 'conversation'), { items: [] });
  assert.deepEqual(queries[0].args, ['conversation']);
});
