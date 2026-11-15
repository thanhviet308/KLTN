import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSwipeTouch,
  LONG_PRESS_DELAY_MS,
  shouldCancelLongPress,
  summarizeMessageForSheet,
  SWIPE_MAX_OFFSET_PX,
} from '../src/features/chat/touch-message-gestures.ts';

test('long-press tolerates sub-threshold tap jitter and cancels on movement', () => {
  assert.ok(LONG_PRESS_DELAY_MS >= 300 && LONG_PRESS_DELAY_MS <= 500);
  assert.equal(shouldCancelLongPress(0, 0), false);
  assert.equal(shouldCancelLongPress(6, -8), false);
  assert.equal(shouldCancelLongPress(9, 0), true);
  assert.equal(shouldCancelLongPress(0, 9), true);
});

test('swipe evaluation prioritizes vertical scroll and locks inward horizontal reply drag', () => {
  assert.deepEqual(
    evaluateSwipeTouch({
      startX: 100,
      startY: 200,
      currentX: 105,
      currentY: 204,
      mine: false,
      axis: 'undecided',
    }),
    { axis: 'undecided', offsetX: 0, ready: false },
  );

  // Vertical timeline scroll wins and ignores subsequent sideways drift.
  const scrollStart = evaluateSwipeTouch({
    startX: 100,
    startY: 200,
    currentX: 104,
    currentY: 218,
    mine: false,
    axis: 'undecided',
  });
  assert.equal(scrollStart.axis, 'vertical');
  assert.deepEqual(
    evaluateSwipeTouch({
      startX: 100,
      startY: 200,
      currentX: 180,
      currentY: 220,
      mine: false,
      axis: scrollStart.axis,
    }),
    { axis: 'vertical', offsetX: 0, ready: false },
  );

  // Peer message (left-aligned) swipes right into reply threshold.
  const peerMid = evaluateSwipeTouch({
    startX: 40,
    startY: 300,
    currentX: 68,
    currentY: 302,
    mine: false,
    axis: 'undecided',
  });
  assert.equal(peerMid.axis, 'horizontal');
  assert.ok(peerMid.offsetX > 0 && peerMid.offsetX < SWIPE_MAX_OFFSET_PX);
  assert.equal(peerMid.ready, false);

  const peerReady = evaluateSwipeTouch({
    startX: 40,
    startY: 300,
    currentX: 145,
    currentY: 305,
    mine: false,
    axis: peerMid.axis,
  });
  assert.equal(peerReady.axis, 'horizontal');
  assert.equal(peerReady.offsetX, SWIPE_MAX_OFFSET_PX);
  assert.equal(peerReady.ready, true);

  // Own message (right-aligned) swipes left into reply threshold, never off right edge.
  const ownWrongDir = evaluateSwipeTouch({
    startX: 250,
    startY: 300,
    currentX: 290,
    currentY: 301,
    mine: true,
    axis: 'undecided',
  });
  assert.deepEqual(ownWrongDir, { axis: 'vertical', offsetX: 0, ready: false });

  const ownReady = evaluateSwipeTouch({
    startX: 250,
    startY: 300,
    currentX: 190,
    currentY: 304,
    mine: true,
    axis: 'undecided',
  });
  assert.equal(ownReady.axis, 'horizontal');
  assert.ok(ownReady.offsetX < 0);
  assert.equal(ownReady.ready, true);
});

test('summarizeMessageForSheet formats previews cleanly for each message type', () => {
  const base = {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'u1',
    clientMessageId: 'cm1',
    sequence: '1',
    type: 'text',
    body: 'Xin chào cả nhà',
    createdAt: '2026-11-15T00:00:00Z',
    editedAt: null,
    deletedAt: null,
  };
  assert.equal(summarizeMessageForSheet(base), 'Xin chào cả nhà');
  assert.equal(
    summarizeMessageForSheet({ ...base, deletedAt: '2026-11-15T00:01:00Z' }),
    'Tin nhắn đã thu hồi',
  );
  assert.equal(
    summarizeMessageForSheet(base, 'Cờ caro 3×3'),
    'Trò chơi · Cờ caro 3×3',
  );
  assert.equal(
    summarizeMessageForSheet({
      ...base,
      type: 'image',
      content: { fileName: 'anh.png' },
    }),
    'Hình ảnh · anh.png',
  );
  assert.equal(
    summarizeMessageForSheet({ ...base, type: 'voice' }),
    'Tin nhắn thoại',
  );
  assert.equal(
    summarizeMessageForSheet({ ...base, type: 'location' }),
    'Vị trí được chia sẻ',
  );
});
