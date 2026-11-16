import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatNoticeContent,
  formatRelativeNoticeTime,
  resolveNoticeActor,
  resolveNoticeDestination,
} from '../src/features/notifications/notification-model.ts';

test('historical friend_request notifications render hydrated actor name and jump to incoming tab', () => {
  const notice = {
    id: 'n-1',
    type: 'friend_request',
    payload: {
      title: 'Bạn có lời mời kết bạn mới',
      requesterId: 'user-bao-tran',
      requestId: 'req-42',
    },
    actor: {
      id: 'user-bao-tran',
      displayName: 'Bảo Trân',
      avatarUrl: '/users/avatars/user-bao-tran.jpg',
    },
    createdAt: '2026-11-15T15:19:03.000Z',
    readAt: null,
  };

  assert.deepEqual(resolveNoticeActor(notice), {
    id: 'user-bao-tran',
    displayName: 'Bảo Trân',
    avatarUrl: '/users/avatars/user-bao-tran.jpg',
  });
  assert.deepEqual(formatNoticeContent(notice), {
    actor: {
      id: 'user-bao-tran',
      displayName: 'Bảo Trân',
      avatarUrl: '/users/avatars/user-bao-tran.jpg',
    },
    actorName: 'Bảo Trân',
    body: 'đã gửi cho bạn lời mời kết bạn.',
    hint: 'Nhấn để xem lời mời kết bạn',
  });
  assert.deepEqual(resolveNoticeDestination(notice), {
    tab: 'incoming',
    requestId: 'req-42',
    actorId: 'user-bao-tran',
  });
});

test('friend_accepted falls back to payload actorName when actor object is absent and opens direct chat', () => {
  const notice = {
    id: 'n-2',
    type: 'friend_accepted',
    payload: {
      title: 'Minh Anh đã chấp nhận lời mời kết bạn của bạn',
      userId: 'user-minh-anh',
      actorName: 'Minh Anh',
    },
    createdAt: '2026-11-15T15:05:52.000Z',
    readAt: null,
  };

  assert.equal(formatNoticeContent(notice).actorName, 'Minh Anh');
  assert.equal(
    formatNoticeContent(notice).body,
    'đã chấp nhận lời mời kết bạn của bạn.',
  );
  assert.deepEqual(resolveNoticeDestination(notice), {
    tab: 'conversations',
    recipientId: 'user-minh-anh',
  });
});

test('friend_request without actor metadata still jumps safely to incoming requests', () => {
  const notice = {
    id: 'n-3',
    type: 'friend_request',
    payload: {
      title: 'Bạn có lời mời kết bạn mới',
    },
    createdAt: '2026-11-15T15:00:00.000Z',
    readAt: '2026-11-15T15:01:00.000Z',
  };

  assert.equal(resolveNoticeActor(notice), undefined);
  assert.equal(formatNoticeContent(notice).body, 'Bạn có lời mời kết bạn mới');
  assert.deepEqual(resolveNoticeDestination(notice), {
    tab: 'incoming',
    requestId: undefined,
    actorId: undefined,
  });
});

test('friend_accepted without any actor ID falls back to friends tab', () => {
  const notice = {
    id: 'n-4',
    type: 'friend_accepted',
    payload: {
      title: 'Lời mời kết bạn đã được chấp nhận',
    },
    createdAt: '2026-11-15T15:00:00.000Z',
    readAt: null,
  };

  assert.deepEqual(resolveNoticeDestination(notice), { tab: 'friends' });
});

test('relative notice timestamps format Vietnamese Facebook-style intervals cleanly', () => {
  const now = Date.parse('2026-11-15T16:00:00.000Z');
  assert.equal(
    formatRelativeNoticeTime('2026-11-15T15:59:30.000Z', now),
    'Vừa xong',
  );
  assert.equal(
    formatRelativeNoticeTime('2026-11-15T15:55:00.000Z', now),
    '5 phút trước',
  );
  assert.equal(
    formatRelativeNoticeTime('2026-11-15T14:00:00.000Z', now),
    '2 giờ trước',
  );
  assert.equal(
    formatRelativeNoticeTime('2026-11-12T16:00:00.000Z', now),
    '3 ngày trước',
  );
});
