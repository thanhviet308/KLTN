const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const {
  CreateMessageRequestDto,
  MessageRequestsQueryDto,
  RespondMessageRequestDto,
} = require('../dist/modules/message-requests/message-requests.dto');

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
