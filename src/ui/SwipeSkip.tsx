import type { ReactNode } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { StyleProp, ViewStyle } from 'react-native';

import { skipNext, skipPrevious } from '../player';
import { tap } from './haptic';
import { lockAxis, swipeOutcome, type SwipeAxis } from './miniSwipe';

/**
 * Swipe on the child: horizontal = skip (left next, right previous), or with `sideways="close"` it closes it (slides
 * out to that side); with `onClose` a downward swipe closes it too.
 * The axis is locked by the first movement, so the two never fire together. The child follows the finger, fading,
 * and springs back unless the gesture counts.
 */
export function SwipeSkip({ children, style, onClose, sideways = 'skip' }: { children: ReactNode; style?: StyleProp<ViewStyle>; onClose?: () => void; sideways?: 'skip' | 'close' }) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const axis = useSharedValue<SwipeAxis | 0>(0);
  const fire = (dir: 'next' | 'prev') => {
    tap();
    void (dir === 'next' ? skipNext() : skipPrevious());
  };
  const close = () => onClose?.();
  const base = Gesture.Pan().activeOffsetX([-10, 10]);
  const pan = (onClose ? base.activeOffsetY([-10, 10]) : base.failOffsetY([-24, 24]))
    .onBegin(() => {
      axis.value = 0;
    })
    .onUpdate((e) => {
      if (!axis.value) axis.value = lockAxis(e.translationX, e.translationY) ?? 0;
      if (axis.value === 'horizontal') x.value = e.translationX;
      else if (axis.value === 'vertical') y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const a = axis.value || undefined;
      const out = swipeOutcome(a, e.translationX, e.translationY, e.velocityY);
      if ((out === 'skip-next' || out === 'skip-prev') && sideways === 'close' && onClose) {
        x.value = withTiming(out === 'skip-next' ? -500 : 500, { duration: 180 }, (done) => {
          if (done) scheduleOnRN(close);
        });
      } else if (out === 'skip-next' || out === 'skip-prev') {
        scheduleOnRN(fire, out === 'skip-next' ? 'next' : 'prev');
        x.value = withTiming(0, { duration: 220 });
      } else if (out === 'close' && onClose) {
        y.value = withTiming(160, { duration: 180 }, (done) => {
          if (done) scheduleOnRN(close);
        });
      } else {
        x.value = withSpring(0);
        y.value = withSpring(0);
      }
    });
  const s = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
    opacity: 1 - Math.min(Math.abs(x.value), 160) / 400 - Math.min(y.value, 120) / 160,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, s]}>{children}</Animated.View>
    </GestureDetector>
  );
}
