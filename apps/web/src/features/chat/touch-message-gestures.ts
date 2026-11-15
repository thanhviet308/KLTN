import type { Message } from '../../lib/chat-model';

export const LONG_PRESS_DELAY_MS = 380;
export const TOUCH_MOVE_CANCEL_PX = 8;
export const SWIPE_LOCK_THRESHOLD_PX = 10;
export const SWIPE_REPLY_TRIGGER_PX = 50;
export const SWIPE_MAX_OFFSET_PX = 68;

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

export interface SwipeEvaluation {
  axis: SwipeAxis;
  offsetX: number;
  ready: boolean;
}

/**
 * Cancels a pending long-press hold once the finger drifts past tap jitter.
 */
export function shouldCancelLongPress(dx: number, dy: number): boolean {
  return (
    Math.abs(dx) > TOUCH_MOVE_CANCEL_PX || Math.abs(dy) > TOUCH_MOVE_CANCEL_PX
  );
}

/**
 * Classifies single-finger drag motion on a message bubble so vertical timeline
 * scrolling stays native while inward horizontal pulls slide into quick reply.
 */
export function evaluateSwipeTouch({
  startX,
  startY,
  currentX,
  currentY,
  mine,
  axis,
}: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mine: boolean;
  axis: SwipeAxis;
}): SwipeEvaluation {
  if (axis === 'vertical') {
    return { axis: 'vertical', offsetX: 0, ready: false };
  }

  const dx = currentX - startX;
  const dy = currentY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let nextAxis = axis;
  if (nextAxis === 'undecided') {
    if (absDx <= SWIPE_LOCK_THRESHOLD_PX && absDy <= SWIPE_LOCK_THRESHOLD_PX) {
      return { axis: 'undecided', offsetX: 0, ready: false };
    }
    if (absDy >= absDx * 0.9) {
      return { axis: 'vertical', offsetX: 0, ready: false };
    }
    const inward = mine ? -dx : dx;
    if (inward <= 0) {
      return { axis: 'vertical', offsetX: 0, ready: false };
    }
    nextAxis = 'horizontal';
  }

  const inward = Math.max(0, mine ? -dx : dx);
  const magnitude = Math.min(SWIPE_MAX_OFFSET_PX, Math.round(inward * 0.72));
  const offsetX = magnitude === 0 ? 0 : mine ? -magnitude : magnitude;
  return {
    axis: nextAxis,
    offsetX,
    ready: inward >= SWIPE_REPLY_TRIGGER_PX,
  };
}

/**
 * Avoids hijacking touch gestures inside buttons, audio scrubbers, or reaction pills.
 */
export function isTouchControlElement(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      'button, input, textarea, select, [role="button"], .reaction-badges, .message-tools, audio, video',
    ) !== null
  );
}

/**
 * Detects touch-first devices where message actions belong in gestures rather than hover bars.
 */
export function isCoarseTouchDevice(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

/**
 * Builds a concise preview string for the mobile long-press action sheet header.
 */
export function summarizeMessageForSheet(
  message: Message,
  gameTitle?: string,
): string {
  if (message.deletedAt) return 'Tin nhắn đã thu hồi';
  if (gameTitle) return `Trò chơi · ${gameTitle}`;
  if (message.type === 'image') {
    return message.content?.fileName
      ? `Hình ảnh · ${message.content.fileName}`
      : 'Hình ảnh';
  }
  if (message.type === 'voice') return 'Tin nhắn thoại';
  if (message.type === 'file') {
    return message.content?.fileName
      ? `Tệp · ${message.content.fileName}`
      : 'Tệp đính kèm';
  }
  if (message.type === 'location') return 'Vị trí được chia sẻ';
  return (message.body ?? '').trim() || 'Tin nhắn';
}
