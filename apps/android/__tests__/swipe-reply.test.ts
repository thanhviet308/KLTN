import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type * as api from '../src/api';
import {
  evaluateAndroidSwipe,
  isHorizontalReplyIntent,
  SWIPE_CAPTURE_DX,
  SWIPE_MAX_OFFSET,
  SWIPE_REPLY_THRESHOLD,
} from '../src/features/chat/swipe-reply';
import { SwipeableMessageBubble } from '../src/features/chat/SwipeableMessageBubble';

const sampleMessage: api.Message = {
  id: 'm1',
  conversationId: 'c1',
  senderId: 'u2',
  clientMessageId: 'cm1',
  sequence: '1',
  type: 'text',
  body: 'Xin chào',
  createdAt: '2026-11-15T08:00:00Z',
  editedAt: null,
  deletedAt: null,
};

describe('Android swipe-to-reply gesture evaluation', () => {
  test('recognizes inward horizontal swipe and ignores vertical scroll, outward swipe, and disabled messages', () => {
    expect(isHorizontalReplyIntent({ dx: 24, dy: 4, mine: false })).toBe(true);
    expect(isHorizontalReplyIntent({ dx: -24, dy: 4, mine: true })).toBe(true);

    // Outward swipes should not trigger reply capture
    expect(isHorizontalReplyIntent({ dx: -24, dy: 0, mine: false })).toBe(
      false,
    );
    expect(isHorizontalReplyIntent({ dx: 24, dy: 0, mine: true })).toBe(false);

    // Sub-threshold tap wobble stays ignored so long-press keeps firing cleanly
    expect(
      isHorizontalReplyIntent({
        dx: SWIPE_CAPTURE_DX - 1,
        dy: 0,
        mine: false,
      }),
    ).toBe(false);

    // Predominantly vertical drags belong to FlatList scrolling
    expect(isHorizontalReplyIntent({ dx: 18, dy: 28, mine: false })).toBe(
      false,
    );

    // Recalled or call cards never capture swipe gestures
    expect(
      isHorizontalReplyIntent({
        dx: 40,
        dy: 0,
        mine: false,
        disabled: true,
      }),
    ).toBe(false);
  });

  test('computes threshold readiness and resistance-clamped offsets per message direction', () => {
    expect(evaluateAndroidSwipe(26, false)).toEqual({
      offset: 26,
      ready: false,
      progress: 0.5,
    });

    const atThresholdPeer = evaluateAndroidSwipe(SWIPE_REPLY_THRESHOLD, false);
    expect(atThresholdPeer).toEqual({
      offset: SWIPE_REPLY_THRESHOLD,
      ready: true,
      progress: 1,
    });

    const cappedPeer = evaluateAndroidSwipe(240, false);
    expect(cappedPeer).toEqual({
      offset: SWIPE_MAX_OFFSET,
      ready: true,
      progress: 1,
    });

    const atThresholdMine = evaluateAndroidSwipe(-SWIPE_REPLY_THRESHOLD, true);
    expect(atThresholdMine).toEqual({
      offset: -SWIPE_REPLY_THRESHOLD,
      ready: true,
      progress: 1,
    });

    const cappedMine = evaluateAndroidSwipe(-240, true);
    expect(cappedMine).toEqual({
      offset: -SWIPE_MAX_OFFSET,
      ready: true,
      progress: 1,
    });

    // Outward drag stays pinned at zero
    expect(evaluateAndroidSwipe(-35, false)).toEqual({
      offset: 0,
      ready: false,
      progress: 0,
    });
    expect(evaluateAndroidSwipe(35, true)).toEqual({
      offset: 0,
      ready: false,
      progress: 0,
    });
  });

  test('renders swipe indicator only for active messages', async () => {
    const onReply = jest.fn();
    let enabledTree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      enabledTree = ReactTestRenderer.create(
        React.createElement(SwipeableMessageBubble, {
          message: sampleMessage,
          mine: false,
          onReply,
          children: React.createElement(Text, null, 'Xin chào'),
        }),
      );
    });
    expect(
      enabledTree?.root.findAllByType(Text).map(node => node.props.children),
    ).toEqual(['↩', 'Xin chào']);

    let disabledTree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      disabledTree = ReactTestRenderer.create(
        React.createElement(SwipeableMessageBubble, {
          message: sampleMessage,
          mine: false,
          disabled: true,
          onReply,
          children: React.createElement(Text, null, 'Đã thu hồi'),
        }),
      );
    });
    expect(
      disabledTree?.root.findAllByType(Text).map(node => node.props.children),
    ).toEqual(['Đã thu hồi']);
  });
});
