const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  ConversationsService,
} = require('../dist/modules/conversations/conversations.service');
const {
  ConversationBackgroundDto,
  ConversationNicknameDto,
} = require('../dist/modules/conversations/conversations.dto');
const {
  Conversation,
} = require('../dist/modules/database/entities/conversation.entity');
const {
  ConversationMember,
} = require('../dist/modules/database/entities/conversation-member.entity');
const {
  ConversationMemberPeriod,
} = require('../dist/modules/database/entities/conversation-member-period.entity');
const { User } = require('../dist/modules/database/entities/user.entity');

function fixture(type = 'direct') {
  const conversation = {
    id: 'chat',
    type,
    background: 'default',
    nicknames: { peer: 'Old name' },
  };
  const writes = [];
  const locks = [];
  const current = new Set(['actor', 'peer']);
  const manager = {
    getRepository(entity) {
      if (entity === Conversation)
        return {
          findOne: async ({ lock }) => {
            locks.push(lock.mode);
            return conversation;
          },
          save: async (value) => {
            writes.push(structuredClone(value));
            return value;
          },
        };
      if (entity === ConversationMemberPeriod)
        return {
          findOneBy: async ({ userId }) => (current.has(userId) ? {} : null),
        };
      if (entity === ConversationMember)
        return {
          findOneBy: async ({ userId }) => ({
            userId,
            role: 'member',
            lastReadSequence: null,
          }),
        };
      if (entity === User)
        return {
          createQueryBuilder() {
            return {
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              getCount: async () => 0,
            };
          },
        };
      throw new Error('Unexpected repository');
    },
  };
  return {
    service: new ConversationsService({ transaction: (work) => work(manager) }),
    conversation,
    writes,
    locks,
    current,
  };
}

test('current members can customize direct and group chats and restore defaults', async () => {
  for (const type of ['direct', 'group']) {
    const { service, conversation, locks } = fixture(type);
    const result = await service.nickname(
      'actor',
      'chat',
      'actor',
      'My nickname',
    );
    assert.deepEqual(result.conversation.nicknames, {
      actor: 'My nickname',
      peer: 'Old name',
    });
    await service.nickname('actor', 'chat', 'peer', '');
    assert.deepEqual(conversation.nicknames, { actor: 'My nickname' });
    assert.equal(
      (await service.background('actor', 'chat', 'ocean')).conversation
        .background,
      'ocean',
    );
    assert.equal(
      (await service.background('actor', 'chat', 'default')).conversation
        .background,
      'default',
    );
    assert.ok(locks.every((mode) => mode === 'pessimistic_write'));
  }
});

test('outsiders and former members cannot change chat customization', async () => {
  const { service, writes, current } = fixture();
  current.delete('actor');
  for (const actor of ['actor', 'outsider']) {
    await assert.rejects(
      service.background(actor, 'chat', 'ocean'),
      (error) => error.getStatus() === 404,
    );
    await assert.rejects(
      service.nickname(actor, 'chat', 'peer', 'Name'),
      (error) => error.getStatus() === 404,
    );
  }
  assert.equal(writes.length, 0);
});

test('nicknames can only target current members', async () => {
  const { service, writes, current } = fixture();
  current.delete('peer');
  await assert.rejects(
    service.nickname('actor', 'chat', 'peer', 'Name'),
    (error) => error.getStatus() === 404,
  );
  assert.equal(writes.length, 0);
});

test('DTOs reject invalid backgrounds, oversized nicknames and non-string values', async () => {
  for (const background of [
    'url(https://example.com/image)',
    '',
    null,
    1,
    'unknown',
  ]) {
    assert.ok(
      (
        await validate(
          plainToInstance(ConversationBackgroundDto, { background }),
        )
      ).length,
    );
  }
  for (const nickname of [null, 1, {}, 'a'.repeat(51)]) {
    assert.ok(
      (await validate(plainToInstance(ConversationNicknameDto, { nickname })))
        .length,
    );
  }
  for (const nickname of ['', '  ', '  Friend  ']) {
    const dto = plainToInstance(ConversationNicknameDto, { nickname });
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.nickname, nickname.trim());
  }
});
