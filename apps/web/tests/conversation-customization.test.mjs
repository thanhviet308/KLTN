import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conversationTitle,
  visibleConversations,
} from '../src/features/conversations/types.ts';

const direct = {
  id: 'chat',
  type: 'direct',
  title: null,
  peer: { id: 'peer', displayName: 'Original' },
  nicknames: { peer: 'Best friend' },
  createdAt: '2026-11-14T00:00:00Z',
};

test('direct titles and search use the nickname scoped to that chat', () => {
  assert.equal(conversationTitle(direct, {}), 'Best friend');
  assert.equal(visibleConversations([direct], 'all', 'best', {}).length, 1);
  assert.equal(conversationTitle({ ...direct, nicknames: {} }, {}), 'Original');
  assert.equal(
    conversationTitle({ ...direct, type: 'group', title: 'Group' }, {}),
    'Group',
  );
});

test('Messenger-style message requests put outgoing non-friend chats in All and incoming pending requests in Chờ', () => {
  const outgoingThread = {
    ...direct,
    id: 'outgoing-req',
    messageRequest: { id: 'req-1', direction: 'outgoing', status: 'pending' },
    unreadCount: 0,
  };
  const incomingThread = {
    ...direct,
    id: 'incoming-req',
    messageRequest: { id: 'req-2', direction: 'incoming', status: 'pending' },
    unreadCount: 2,
  };
  const friendThread = {
    ...direct,
    id: 'friend-chat',
    messageRequest: null,
    unreadCount: 1,
  };
  const list = [outgoingThread, incomingThread, friendThread];

  assert.deepEqual(
    visibleConversations(list, 'all', '', {})
      .map((item) => item.id)
      .sort(),
    ['friend-chat', 'outgoing-req'],
  );
  assert.deepEqual(
    visibleConversations(list, 'unread', '', {}).map((item) => item.id),
    ['friend-chat'],
  );
  assert.deepEqual(
    visibleConversations(list, 'requests', '', {}).map((item) => item.id),
    ['incoming-req'],
  );
});
