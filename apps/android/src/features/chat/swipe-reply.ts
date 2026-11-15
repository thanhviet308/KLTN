export const SWIPE_REPLY_THRESHOLD = 52;
export const SWIPE_MAX_OFFSET = 76;
export const SWIPE_CAPTURE_DX = 10;
export const SWIPE_DIRECTION_RATIO = 1.4;

export interface SwipeIntentInput {
  dx: number;
  dy: number;
  mine: boolean;
  disabled?: boolean;
}

export interface SwipeOffsetState {
  offset: number;
  ready: boolean;
  progress: number;
}

/**
 * Determine whether a touch movement represents an intentional horizontal
 * inward swipe to reply rather than vertical scrolling or tap jitter.
 */
export function isHorizontalReplyIntent({
  dx,
  dy,
  mine,
  disabled,
}: SwipeIntentInput): boolean {
  if (disabled) return false;
  const inward = mine ? -dx : dx;
  if (inward < SWIPE_CAPTURE_DX) return false;
  return inward > Math.abs(dy) * SWIPE_DIRECTION_RATIO;
}

/**
 * Clamp inward horizontal drag displacement into a signed translateX offset
 * with gentle resistance past the reply activation threshold.
 */
export function evaluateAndroidSwipe(
  dx: number,
  mine: boolean,
): SwipeOffsetState {
  const raw = mine ? Math.max(0, -dx) : Math.max(0, dx);
  const damped =
    raw <= SWIPE_REPLY_THRESHOLD
      ? raw
      : SWIPE_REPLY_THRESHOLD + (raw - SWIPE_REPLY_THRESHOLD) * 0.35;
  const clamped = Math.min(SWIPE_MAX_OFFSET, damped);
  return {
    offset: clamped === 0 ? 0 : mine ? -clamped : clamped,
    ready: raw >= SWIPE_REPLY_THRESHOLD,
    progress: Math.min(1, raw / SWIPE_REPLY_THRESHOLD),
  };
}
