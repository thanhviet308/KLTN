import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Text,
  Vibration,
  View,
} from 'react-native';
import type * as api from '../../api';
import { styles } from '../../styles';
import {
  evaluateAndroidSwipe,
  isHorizontalReplyIntent,
  SWIPE_MAX_OFFSET,
  SWIPE_REPLY_THRESHOLD,
} from './swipe-reply';

export interface SwipeableMessageBubbleProps {
  message: api.Message;
  mine: boolean;
  disabled?: boolean;
  onReply: (message: api.Message) => void;
  children: React.ReactNode;
}

export function triggerTouchHaptic(durationMs = 10) {
  try {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate(durationMs);
    }
  } catch {
    // Ignore when haptic hardware or native bridge is unavailable (e.g. Jest).
  }
}

export const SwipeableMessageBubble = memo(function SwipeableMessageBubble({
  message,
  mine,
  disabled,
  onReply,
  children,
}: SwipeableMessageBubbleProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const latestRef = useRef({ message, mine, disabled, onReply });
  latestRef.current = { message, mine, disabled, onReply };

  const resetPosition = useCallback(() => {
    readyRef.current = false;
    setReady(false);
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 140,
      friction: 14,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_evt, gestureState) =>
          isHorizontalReplyIntent({
            dx: gestureState.dx,
            dy: gestureState.dy,
            mine: latestRef.current.mine,
            disabled: latestRef.current.disabled,
          }),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_evt, gestureState) => {
          const state = evaluateAndroidSwipe(
            gestureState.dx,
            latestRef.current.mine,
          );
          translateX.setValue(state.offset);
          if (state.ready !== readyRef.current) {
            readyRef.current = state.ready;
            setReady(state.ready);
            if (state.ready) triggerTouchHaptic(10);
          }
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const current = latestRef.current;
          const state = evaluateAndroidSwipe(gestureState.dx, current.mine);
          resetPosition();
          if (!current.disabled && state.ready) {
            current.onReply(current.message);
          }
        },
        onPanResponderTerminate: () => {
          resetPosition();
        },
      }),
    [resetPosition, translateX],
  );

  const indicatorOpacity = translateX.interpolate({
    inputRange: mine
      ? [-SWIPE_REPLY_THRESHOLD, -14, 0]
      : [0, 14, SWIPE_REPLY_THRESHOLD],
    outputRange: mine ? [1, 0.55, 0] : [0, 0.55, 1],
    extrapolate: 'clamp',
  });

  const indicatorScale = translateX.interpolate({
    inputRange: mine
      ? [-SWIPE_MAX_OFFSET, -SWIPE_REPLY_THRESHOLD, 0]
      : [0, SWIPE_REPLY_THRESHOLD, SWIPE_MAX_OFFSET],
    outputRange: mine ? [1.08, 1, 0.65] : [0.65, 1, 1.08],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeRow} {...panResponder.panHandlers}>
      {!disabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeReplyBadge,
            mine ? styles.swipeReplyBadgeMine : styles.swipeReplyBadgePeer,
            ready && styles.swipeReplyBadgeReady,
            {
              opacity: indicatorOpacity,
              transform: [{ scale: indicatorScale }],
            },
          ]}
        >
          <Text
            style={[styles.swipeReplyIcon, ready && styles.swipeReplyIconReady]}
          >
            ↩
          </Text>
        </Animated.View>
      )}
      <Animated.View
        style={[
          styles.swipeBubbleWrap,
          mine ? styles.swipeBubbleWrapMine : styles.swipeBubbleWrapPeer,
          { transform: [{ translateX }] },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
});
