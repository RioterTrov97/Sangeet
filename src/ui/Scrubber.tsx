/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated by design */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { clamp, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { StyleSheet } from 'react-native-unistyles';

import { formatDuration } from '../player/format';

/**
 * Seek bar drawn with Reanimated + a pan gesture instead of a native UISlider: the native control
 * rendered above the queue bottom sheet. Shows elapsed (left) and remaining (right) time.
 */
export function Scrubber({ position, duration, onSeek, tint = '#fff', dim }: { position: number; duration: number; onSeek: (sec: number) => void; tint?: string; /** Colour of the elapsed / remaining times. */ dim?: string }) {
  const width = useSharedValue(1);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const dur = Math.max(duration, 1);

  useEffect(() => {
    if (!dragging.value) progress.value = clamp(position / dur, 0, 1);
  }, [position, dur, progress, dragging]);

  const commit = (frac: number) => {
    setScrub(null);
    onSeek(frac * dur);
  };
  const preview = (frac: number) => setScrub(frac * dur);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = true;
      progress.value = clamp(e.x / width.value, 0, 1);
      scheduleOnRN(preview, progress.value);
    })
    .onUpdate((e) => {
      progress.value = clamp(e.x / width.value, 0, 1);
      scheduleOnRN(preview, progress.value);
    })
    .onFinalize(() => {
      dragging.value = false;
      scheduleOnRN(commit, progress.value);
    });

  const fill = useAnimatedStyle(() => ({ width: progress.value * width.value }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * width.value - 6 }, { scale: withTiming(dragging.value ? 1.4 : 1, { duration: 120 }) }],
  }));
  const shown = scrub ?? position;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={styles.hit}
          onLayout={(e) => (width.value = e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          accessibilityValue={{ text: `${formatDuration(position)} of ${formatDuration(duration)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onSeek(Math.max(0, Math.min(dur, position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))))}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, { backgroundColor: tint }, fill]} />
          </View>
          <Animated.View style={[styles.thumb, { backgroundColor: tint }, thumb]} />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text style={[styles.time, dim ? { color: dim } : null]}>{formatDuration(shown)}</Text>
        <Text style={[styles.time, dim ? { color: dim } : null]}>-{formatDuration(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hit: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 4 },
  thumb: { position: 'absolute', left: 0, top: 8, width: 12, height: 12, borderRadius: 6 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: theme.colors.textSecondary, ...theme.typography.caption },
}));
