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
