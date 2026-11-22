import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Icon } from '../tv/icons';

function Bar({ delay, animate, color }: { delay: number; animate: boolean; color: string }) {
  const h = useSharedValue(0.3);
  useEffect(() => {
    if (animate) h.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420 }), withTiming(0.25, { duration: 420 })), -1));
    else h.value = withTiming(0.4, { duration: 150 });
  }, [animate, delay, h]);
  // A transform, not a height: animating the height re-lays-out the tree on every frame.
  const s = useAnimatedStyle(() => ({ transform: [{ scaleY: h.value }] }));
  return <Animated.View style={[{ width: 3, height: 14, borderRadius: 1, backgroundColor: color, transformOrigin: 'bottom' }, s]} />;
}

/** Static bar heights on TV: any animation or timer redraws the whole TV window (700 frames per 6 s measured). */
const TV_BARS = [8, 14, 10];

/**
 * Three bouncing bars shown on the now-playing row; they freeze when paused. On TV they are static bars while playing and
 * a pause icon while paused (no animation at all).
 */
export function Equalizer({ playing, color = '#1ED760' }: { playing: boolean; color?: string }) {
  if (Platform.isTV) {
    if (!playing) return <Icon name="pause" size={18} color={color} />;
    return (
      <View style={{ height: 14, width: 15, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {TV_BARS.map((h, i) => (
          <View key={i} style={{ width: 3, height: h, borderRadius: 1, backgroundColor: color }} />
        ))}
      </View>
    );
  }
  return (
    <View style={{ height: 14, width: 15, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Bar delay={0} animate={playing} color={color} />
      <Bar delay={140} animate={playing} color={color} />
      <Bar delay={280} animate={playing} color={color} />
    </View>
  );
}
