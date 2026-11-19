const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
process.env.MESSAGE_ENCRYPTION_KEYS =
  process.env.MESSAGE_ENCRYPTION_KEYS || `1:${'18'.repeat(32)}`;
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  CreateMessageRequestDto,
  MessageRequestsQueryDto,
  RespondMessageRequestDto,
} = require('../dist/modules/message-requests/message-requests.dto');
const {
  MessagesService,
} = require('../dist/modules/messages/messages.service');
const {
  Conversation,
} = require('../dist/modules/database/entities/conversation.entity');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const {
  MessageRequest,
} = require('../dist/modules/database/entities/message-request.entity');
const { Message } = require('../dist/modules/database/entities/message.entity');
const { User } = require('../dist/modules/database/entities/user.entity');

const first = '11111111-1111-4111-8111-111111111111';

test('message request input trims a bounded opening message', async () => {
  const input = plainToInstance(CreateMessageRequestDto, {
    recipientId: first.toUpperCase(),
    body: '  Xin chào, mình muốn trao đổi về đồ án.  ',
  });
  assert.equal(input.recipientId, first);
  assert.equal(input.body, 'Xin chào, mình muốn trao đổi về đồ án.');
  assert.deepEqual(await validate(input), []);
  assert.notDeepEqual(
    await validate(
      plainToInstance(CreateMessageRequestDto, {
        recipientId: first,
        body: ' '.repeat(10),
      }),
    ),
    [],
  );
  assert.notDeepEqual(
    await validate(
      plainToInstance(CreateMessageRequestDto, {
        recipientId: first,
        body: 'a'.repeat(2001),
      }),
    ),
    [],
  );
});

test('message request list and response accept only supported states', async () => {
  const query = plainToInstance(MessageRequestsQueryDto, {
    direction: 'incoming',
    limit: '20',
  });
  assert.deepEqual(await validate(query), []);
  assert.deepEqual(
    await validate(
      plainToInstance(MessageRequestsQueryDto, {
        direction: 'all',
        limit: '20',
      }),
    ),
    [],
  );
  for (const action of ['accept', 'reject', 'cancel'])
    assert.deepEqual(
      await validate(plainToInstance(RespondMessageRequestDto, { action })),
      [],
    );
  assert.notDeepEqual(
    await validate(
      plainToInstance(RespondMessageRequestDto, { action: 'block' }),
    ),
    [],
  );
});

test('non-friend can send multiple messages in direct chat and recipient reply auto-accepts request', async () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const convId = '33333333-3333-4333-8333-333333333333';

  const conversation = {
    id: convId,
    type: 'direct',
    directUserLowId: userA,
    directUserHighId: userB,
    lastMessageSequence: '0',
    deletedAt: null,
  };
  let storedRequest = null;
  const savedMessages = [];
  const syncEvents = [];

  const manager = {
    query: async () => [],
    getRepository(entity) {
      if (entity === User) {
        return {
          createQueryBuilder: () => ({
            where() {
              return this;
            },
            orderBy() {
              return this;
            },
            setLock() {
              return this;
            },
            getMany: async () => [
              { id: userA, status: 'active' },
              { id: userB, status: 'active' },
            ],
          }),
        };
      }
      if (entity === Friendship) {
        return { findOne: async () => null };
      }
      if (entity === MessageRequest) {
        return {
          findOne: async () => storedRequest,
          create: (val) => ({ id: 'req-1', ...val }),
          save: async (val) => {
            storedRequest = { ...val };
            return storedRequest;
          },
        };
      }
      if (entity === Message) {
        return {
          findOneBy: async () => null,
          save: async (val) => {
            const row = {
              id: `msg-${savedMessages.length + 1}`,
              createdAt: new Date(),
              editedAt: null,
              deletedAt: null,
              editedBody: null,
              ...val,
            };
            savedMessages.push(row);
            return row;
          },
        };
      }
      if (entity === Conversation) {
        return {
          update: async (_id, patch) => {
            Object.assign(conversation, patch);
          },
        };
      }
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
  };

  const service = new MessagesService(
    { transaction: async (fn) => fn(manager) },
    {
      requireAccess: async () => ({ conversation, member: { role: 'member' } }),
    },
    {
      publish: () => {},
      friendshipChanged: (a, b, status) => syncEvents.push({ a, b, status }),
    },
    { take: () => {} },
    { predict: async () => null },
  );

  // 1. Sender A sends message #1 -> creates pending message request
  const firstMsg = await service.send(userA, convId, {
    clientMessageId: 'aaaa0001-0000-4000-8000-000000000001',
    type: 'text',
    body: 'Chào bạn nha!',
  });
  assert.equal(firstMsg.message.sequence, '1');
  assert.equal(storedRequest.status, 'pending');
  assert.equal(storedRequest.requesterId, userA);
  assert.equal(storedRequest.recipientId, userB);
  assert.equal(storedRequest.body, 'Chào bạn nha!');

  // 2. Sender A sends message #2 -> succeeds without MESSAGE_REQUEST_PENDING error!
  const secondMsg = await service.send(userA, convId, {
    clientMessageId: 'aaaa0002-0000-4000-8000-000000000002',
    type: 'text',
    body: 'Cho mình hỏi bài tập nhóm với.',
  });
  assert.equal(secondMsg.message.sequence, '2');
  assert.equal(storedRequest.status, 'pending');
  assert.equal(storedRequest.body, 'Cho mình hỏi bài tập nhóm với.');

  // 3. Recipient B replies -> auto-accepts the message request!
  const replyMsg = await service.send(userB, convId, {
    clientMessageId: 'bbbb0001-0000-4000-8000-000000000003',
    type: 'text',
    body: 'Chào bạn, bạn hỏi đi!',
  });
  assert.equal(replyMsg.message.sequence, '3');
  assert.equal(storedRequest.status, 'accepted');
  assert.ok(storedRequest.respondedAt instanceof Date);
  assert.equal(syncEvents.at(-1).status, 'accepted');
});
