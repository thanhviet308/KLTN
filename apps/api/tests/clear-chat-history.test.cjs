const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.MESSAGE_ENCRYPTION_KEYS =
  process.env.MESSAGE_ENCRYPTION_KEYS || `1:${'18'.repeat(32)}`;
const {
  ConversationsService,
} = require('../dist/modules/conversations/conversations.service');
const {
  MessagesService,
} = require('../dist/modules/messages/messages.service');
const {
  WorkspaceService,
} = require('../dist/modules/workspace/workspace.service');
const { AiService } = require('../dist/modules/ai/ai.service');
const {
  Conversation,
} = require('../dist/modules/database/entities/conversation.entity');
const {
  ConversationMember,
} = require('../dist/modules/database/entities/conversation-member.entity');
const {
  ConversationMemberPeriod,
} = require('../dist/modules/database/entities/conversation-member-period.entity');
const { Message } = require('../dist/modules/database/entities/message.entity');
const { User } = require('../dist/modules/database/entities/user.entity');

function clearHistoryFixture(initialCleared = '0', lastSeq = '12') {
  const conversation = {
    id: 'conv-1',
    type: 'group',
    title: 'Nhóm test',
    background: 'default',
    nicknames: {},
    creatorId: 'actor',
    directUserLowId: null,
    directUserHighId: null,
    lastMessageSequence: lastSeq,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const members = {
    actor: {
      conversationId: 'conv-1',
      userId: 'actor',
      role: 'member',
      lastReadSequence: '10',
      clearedAfterSequence: initialCleared,
    },
    peer: {
      conversationId: 'conv-1',
      userId: 'peer',
      role: 'owner',
      lastReadSequence: '12',
      clearedAfterSequence: '0',
    },
  };
  const active = new Set(['actor', 'peer']);
  const updates = [];
  const published = [];
  let committed = false;

  const manager = {
    getRepository(entity) {
      if (entity === Conversation) {
        return {
          findOne: async ({ lock }) => {
            assert.equal(lock.mode, 'pessimistic_write');
            return conversation;
          },
        };
      }
      if (entity === ConversationMemberPeriod) {
        return {
          findOneBy: async ({ userId }) => (active.has(userId) ? {} : null),
        };
      }
      if (entity === ConversationMember) {
        return {
          findOneBy: async ({ userId }) => members[userId] ?? null,
          update: async (criteria, patch) => {
            updates.push({ criteria, patch });
            const target = members[criteria.userId];
            if (target) Object.assign(target, patch);
          },
        };
      }
      if (entity === User) {
        return {
          createQueryBuilder: () => ({
            where() {
              return this;
            },
            andWhere() {
              return this;
            },
            getCount: async () => 0,
          }),
        };
      }
      throw new Error('Unexpected repository');
    },
  };

  const db = {
    transaction: async (work) => {
      const value = await work(manager);
      committed = true;
      return value;
    },
  };
  const events = {
    publish: (event) => {
      assert.equal(committed, true);
      published.push(event);
    },
  };
  return {
    service: new ConversationsService(db, events),
    conversation,
    members,
    active,
    updates,
    published,
  };
}

test('clearHistory advances clearedAfterSequence only for the actor and publishes targeted realtime event', async () => {
  const f = clearHistoryFixture('2', '15');
  const result = await f.service.clearHistory('actor', 'conv-1');

  assert.equal(result.clearedAfterSequence, '15');
  assert.equal(result.conversation.membership.clearedAfterSequence, '15');
  assert.equal(f.members.peer.clearedAfterSequence, '0');
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0], {
    criteria: { conversationId: 'conv-1', userId: 'actor' },
    patch: { clearedAfterSequence: '15' },
  });
  assert.deepEqual(f.published, [
    {
      name: 'conversation:history-cleared',
      conversationId: 'conv-1',
      targetUserIds: ['actor'],
      payload: {
        conversationId: 'conv-1',
        clearedAfterSequence: '15',
      },
    },
  ]);
});

test('clearHistory is idempotent when already cleared up to latest sequence', async () => {
  const f = clearHistoryFixture('15', '15');
  const result = await f.service.clearHistory('actor', 'conv-1');

  assert.equal(result.clearedAfterSequence, '15');
  assert.equal(f.updates.length, 0);
  assert.equal(f.published.length, 1);
});

test('outsiders and former members cannot clear conversation history', async () => {
  const f = clearHistoryFixture('0', '10');
  f.active.delete('actor');
  for (const user of ['actor', 'outsider']) {
    await assert.rejects(
      f.service.clearHistory(user, 'conv-1'),
      (error) => error.getStatus() === 404,
    );
  }
  assert.equal(f.updates.length, 0);
  assert.equal(f.published.length, 0);
});

test('messages, search and AI visibility queries all enforce cleared_after_sequence', async () => {
  const recordedSql = [];
  const createBuilder = () => {
    const builder = {
      where: (sql) => {
        recordedSql.push(sql);
        return builder;
      },
      andWhere: (sql) => {
        recordedSql.push(sql);
        return builder;
      },
      innerJoin: () => builder,
      leftJoinAndSelect: () => builder,
      leftJoin: () => builder,
      addSelect: () => builder,
      orderBy: () => builder,
      take: () => builder,
      getMany: async () => [],
    };
    return builder;
  };
  const manager = {
    getRepository: (entity) => {
      assert.equal(entity, Message);
      return { createQueryBuilder: createBuilder };
    },
  };
  const db = { transaction: (work) => work(manager) };
  const conversations = {
    requireAccess: async () => ({
      conversation: { id: 'conv-1', lastMessageSequence: '10' },
      member: { role: 'member', lastReadSequence: null },
    }),
  };

  const messages = new MessagesService(
    db,
    conversations,
    { publish() {} },
    { take() {} },
    { predict: async () => null },
  );
  await messages.history('actor', 'conv-1', {
    direction: 'backward',
    limit: 20,
  });
  assert.ok(
    recordedSql.some((sql) => sql.includes('cleared_after_sequence')),
    'MessagesService.history must filter by cleared_after_sequence',
  );

  recordedSql.length = 0;
  const workspace = new WorkspaceService(db, conversations, messages, {
    publish() {},
  });
  await workspace.search('actor', {
    query: 'hello world',
    conversationId: 'conv-1',
    limit: 20,
  });
  assert.ok(
    recordedSql.some((sql) => sql.includes('cleared_after_sequence')),
    'WorkspaceService.search must filter by cleared_after_sequence',
  );

  recordedSql.length = 0;
  const ai = new AiService(db, conversations, {
    available: () => true,
  });
  await assert.rejects(
    ai.generate('actor', 'conv-1', {
      kind: 'summary',
      messageIds: ['10000000-0000-4000-8000-000000000001'],
      sourceRevisions: ['rev'],
    }),
  );
  assert.ok(
    recordedSql.some((sql) => sql.includes('cleared_after_sequence')),
    'AiService must filter by cleared_after_sequence',
  );
});
