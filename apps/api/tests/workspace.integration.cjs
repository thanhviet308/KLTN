// Run only against a disposable database: WORKSPACE_TEST_DATABASE_URL=... node --test ...
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { typeormOptions } = require('../dist/modules/database/typeorm-options');
const {
  ConversationsService,
} = require('../dist/modules/conversations/conversations.service');
const {
  MessagesService,
} = require('../dist/modules/messages/messages.service');
const {
  WorkspaceService,
} = require('../dist/modules/workspace/workspace.service');
const {
  AccountsService,
} = require('../dist/modules/workspace/accounts.service');
const { User } = require('../dist/modules/database/entities/user.entity');
const {
  Friendship,
} = require('../dist/modules/database/entities/friendship.entity');
const { Session } = require('../dist/modules/database/entities/session.entity');
const code = (expected) => (error) => error.getResponse().code === expected;

test(
  'workspace features enforce real PostgreSQL constraints, privacy and membership',
  { skip: !process.env.WORKSPACE_TEST_DATABASE_URL },
  async () => {
    process.env.NODE_ENV = 'test';
    process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'18'.repeat(32)}`;
    const db = new DataSource(
      typeormOptions(process.env.WORKSPACE_TEST_DATABASE_URL),
    );
    await db.initialize();
    try {
      await db.runMigrations();
      const users = [];
      for (let i = 0; i < 5; i++)
        users.push(
          await db.getRepository(User).save({
            email: `${randomUUID()}@example.com`,
            displayName: `Member ${i}`,
            passwordHash: 'test-only',
            role: i === 0 ? 'admin' : 'user',
          }),
        );
      const [admin, owner, peer, outsider, late] = users;
      for (const target of [peer, late])
        await db.getRepository(Friendship).save({
          requesterId: owner.id,
          recipientId: target.id,
          status: 'accepted',
        });
      const conversations = new ConversationsService(db);
      const events = { publish() {} };
      const messages = new MessagesService(
        db,
        conversations,
        events,
        { take() {} },
        { predict: async () => null },
      );
      const workspace = new WorkspaceService(db, conversations, messages);
      const accounts = new AccountsService(db, { accessChanged() {} });
      const group = await conversations.create(owner.id, {
        type: 'group',
        title: 'Workspace test',
        memberIds: [peer.id],
        clientRequestId: randomUUID(),
      });
      const conversationId = group.conversation.id;
      const send = (actor, body, mentions) =>
        messages.send(actor.id, conversationId, {
          type: 'text',
          body,
          mentions,
          clientMessageId: randomUUID(),
        });
      const { message } = await send(owner, 'Xin chào thế giới', [peer.id]);
      assert.deepEqual(message.content.mentions, [peer.id]);
      const notices = await db.query(
        'SELECT * FROM notifications WHERE user_id=$1 AND deduplication_key=$2',
        [peer.id, `mention:${message.id}`],
      );
      assert.equal(notices.length, 1);
      await assert.rejects(
        send(owner, 'Bad mention', [outsider.id]),
        code('MENTION_UNAVAILABLE'),
      );
      await workspace.indexBatch();
      assert.equal(
        (await workspace.search(peer.id, { query: 'chao gioi', limit: 20 }))
          .items[0].id,
        message.id,
      );
      assert.equal(
        (await workspace.search(outsider.id, { query: 'chao', limit: 20 }))
          .items.length,
        0,
      );
      const [stored] = await db.query('SELECT body FROM messages WHERE id=$1', [
        message.id,
      ]);
      assert.match(stored.body, /^enc:v1:/);
      const [indexed] = await db.query(
        'SELECT tokens FROM message_search_index WHERE message_id=$1',
        [message.id],
      );
      assert.ok(indexed.tokens.every((t) => /^[a-f0-9]{64}$/.test(t)));
      await assert.rejects(
        workspace.pin(peer.id, conversationId, message.id, false),
        code('GROUP_MANAGER_REQUIRED'),
      );
      await workspace.pin(owner.id, conversationId, message.id, false);
      assert.equal(
        (await workspace.pins(peer.id, conversationId)).items.length,
        1,
      );
      const pollInput = {
        clientRequestId: randomUUID(),
        question: 'Chọn lịch?',
        options: ['Thứ hai', 'Thứ ba'],
        multiple: false,
      };
      const poll = await workspace.createPoll(
        owner.id,
        conversationId,
        pollInput,
      );
      assert.equal(
        (await workspace.createPoll(owner.id, conversationId, pollInput)).id,
        poll.id,
      );
      await assert.rejects(
        workspace.createPoll(owner.id, conversationId, {
          ...pollInput,
          question: 'Khác?',
        }),
        code('POLL_IDEMPOTENCY_CONFLICT'),
      );
      await assert.rejects(
        workspace.vote(outsider.id, conversationId, poll.id, { options: [0] }),
        code('CONVERSATION_NOT_FOUND'),
      );
      await assert.rejects(
        workspace.vote(peer.id, conversationId, poll.id, { options: [0, 1] }),
        code('INVALID_VOTE'),
      );
      await Promise.all([
        workspace.vote(peer.id, conversationId, poll.id, { options: [0] }),
        workspace.vote(peer.id, conversationId, poll.id, { options: [1] }),
      ]);
      let listed = (
        await workspace.polls(owner.id, conversationId, { limit: 20 })
      ).items[0];
      assert.equal(listed.voters, 1);
      assert.equal(
        listed.options.reduce((n, o) => n + o.count, 0),
        1,
      );
      await conversations.addMember(owner.id, conversationId, late.id);
      assert.equal(
        (await workspace.search(late.id, { query: 'chao', limit: 20 })).items
          .length,
        0,
      );
      assert.equal(
        (await workspace.polls(late.id, conversationId, { limit: 20 })).items
          .length,
        0,
      );
      await assert.rejects(
        workspace.closePoll(peer.id, conversationId, poll.id),
        code('POLL_FORBIDDEN'),
      );
      await workspace.closePoll(owner.id, conversationId, poll.id);
      await assert.rejects(
        workspace.vote(peer.id, conversationId, poll.id, { options: [0] }),
        code('POLL_CLOSED'),
      );
      await messages.receipt(peer.id, conversationId, message.id, true);
      assert.equal(
        (
          await messages.receipts(owner.id, conversationId, message.id, {
            limit: 20,
          })
        ).items[0].userId,
        peer.id,
      );
      const destination = await conversations.create(owner.id, {
        type: 'group',
        title: 'Forward target',
        memberIds: [peer.id],
        clientRequestId: randomUUID(),
      });
      const source = {
        conversationId,
        messageId: message.id,
        body: message.body,
        editedAt: null,
      };
      const forwarded = await messages.send(
        peer.id,
        destination.conversation.id,
        { type: 'text', body: message.body, clientMessageId: randomUUID() },
        undefined,
        source,
      );
      assert.equal(forwarded.message.content.forwarded, true);
      await messages.edit(owner.id, conversationId, message.id, {
        body: 'Changed words',
        expectedEditedAt: null,
      });
      assert.equal(
        (
          await workspace.search(peer.id, {
            query: 'chao',
            limit: 20,
            conversationId,
          })
        ).items.length,
        0,
      );
      await assert.rejects(
        messages.send(
          peer.id,
          destination.conversation.id,
          { type: 'text', body: source.body, clientMessageId: randomUUID() },
          undefined,
          source,
        ),
        code('FORWARD_SOURCE_CHANGED'),
      );
      await workspace.indexBatch();
      assert.equal(
        (await workspace.search(peer.id, { query: 'changed', limit: 20 })).items
          .length,
        1,
      );
      const session = await db.getRepository(Session).save({
        userId: peer.id,
        deviceName: 'Test browser',
        expiresAt: new Date(Date.now() + 60000),
      });
      assert.equal(
        (await accounts.sessions(peer.id, session.id)).items[0].current,
        true,
      );
      await assert.rejects(
        accounts.revoke(owner.id, session.id),
        code('SESSION_NOT_FOUND'),
      );
      await accounts.revoke(peer.id, session.id);
      assert.equal(
        (await accounts.sessions(peer.id, session.id)).items.length,
        0,
      );
      await assert.rejects(
        accounts.status(peer, owner.id, 'blocked'),
        code('ADMIN_REQUIRED'),
      );
      await accounts.status(admin, owner.id, 'blocked');
      assert.equal(
        (
          await messages.history(peer.id, conversationId, {
            limit: 20,
            direction: 'backward',
          })
        ).items.length,
        0,
      );
      assert.equal(
        (await workspace.search(peer.id, { query: 'changed', limit: 20 })).items
          .length,
        0,
      );
      await accounts.status(admin, owner.id, 'active');
      await messages.remove(owner.id, conversationId, message.id);
      assert.equal(
        (await workspace.pins(peer.id, conversationId)).items.length,
        0,
      );
      assert.equal(
        (await workspace.search(peer.id, { query: 'changed', limit: 20 })).items
          .length,
        0,
      );
    } finally {
      await db.destroy();
    }
  },
);
