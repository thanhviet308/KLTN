const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  WorkspaceService,
} = require('../dist/modules/workspace/workspace.service');

function fixture({ denied = false, total = 0 } = {}) {
  const writes = [];
  const manager = {
    query: async (sql) => {
      if (sql.startsWith('SELECT')) return [{ total }];
      writes.push(sql);
    },
  };
  const service = new WorkspaceService(
    { transaction: (work) => work(manager) },
    {
      requireAccess: async () => {
        if (denied) throw new Error('Not a current member');
        return { conversation: { type: 'group' }, member: { role: 'member' } };
      },
    },
    { get: async () => ({ message: { id: 'message' } }) },
  );
  return { service, writes };
}

test('ordinary members can pin and unpin a group message', async () => {
  const { service, writes } = fixture();
  await service.pin('member', 'group', 'message', false);
  await service.pin('member', 'group', 'message', true);
  assert.match(writes[0], /^INSERT INTO message_pins/);
  assert.match(writes[1], /^DELETE FROM message_pins/);
});

test('membership is still checked before any pin mutation', async () => {
  const { service, writes } = fixture({ denied: true });
  for (const remove of [false, true]) {
    await assert.rejects(service.pin('outsider', 'group', 'message', remove));
  }
  assert.equal(writes.length, 0);
});

test('pin limit remains enforced for ordinary members', async () => {
  const { service, writes } = fixture({ total: 50 });
  await assert.rejects(
    service.pin('member', 'group', 'message', false),
    (error) => error.getResponse().code === 'PIN_LIMIT',
  );
  assert.equal(writes.length, 0);
});
