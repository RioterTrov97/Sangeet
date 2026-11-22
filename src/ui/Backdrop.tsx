import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { usePaletteColor } from './palette/animated';

/** Reduce Motion flag. */
export function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setOn(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * Full-bleed now-playing background: the palette colour (cross-faded on the UI thread when the track changes), a
 * vertical darkening gradient, and two very slow drifting blobs (transform-only, a few hundred ms of work per minute).
 * Blobs stand still with Reduce Motion or when `paused`.
 */
export function Backdrop({ blobs = true, paused, flat }: { blobs?: boolean; paused?: boolean; /** Plain palette colour only, so edge fades (lyrics) match it exactly. */ flat?: boolean }) {
  const reduce = useReduceMotion();
  const bg = usePaletteColor('bg');
  const accent = usePaletteColor('accent');
  const base = useAnimatedStyle(() => ({ backgroundColor: bg.value }));
  const blobA = useAnimatedStyle(() => ({ backgroundColor: accent.value }));
  const t = useSharedValue(0);
  const animate = blobs && !reduce && !paused;
  useEffect(() => {
    if (!animate) return;
    t.value = withRepeat(withTiming(1, { duration: 24000, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => {
      t.value = 0;
    };
  }, [animate, t]);
  const moveA = useAnimatedStyle(() => ({ transform: [{ translateX: -60 + t.value * 120 }, { translateY: -40 + t.value * 80 }, { scale: 1 + t.value * 0.15 }] }));
  const moveB = useAnimatedStyle(() => ({ transform: [{ translateX: 80 - t.value * 140 }, { translateY: 60 - t.value * 100 }] }));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, base]} />
      {blobs && !flat ? (
        <>
          <Animated.View style={[styles.blobWrap, styles.blobA, moveA]}>
            <Animated.View style={[styles.blob, { width: 420, height: 420, borderRadius: 210 }, blobA]} />
            <Animated.View style={[styles.blob, { width: 320, height: 320, borderRadius: 160 }, blobA]} />
            <Animated.View style={[styles.blob, { width: 220, height: 220, borderRadius: 110 }, blobA]} />
          </Animated.View>
          <Animated.View style={[styles.blobWrap, styles.blobB, moveB]}>
            <Animated.View style={[styles.blob, { width: 380, height: 380, borderRadius: 190 }, blobA]} />
            <Animated.View style={[styles.blob, { width: 270, height: 270, borderRadius: 135 }, blobA]} />
            <Animated.View style={[styles.blob, { width: 170, height: 170, borderRadius: 85 }, blobA]} />
          </Animated.View>
        </>
      ) : null}
      {flat ? null : <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.38)']} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  blobWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  blob: { position: 'absolute', opacity: 0.07 },
  blobA: { top: -60, left: -100, width: 420, height: 420 },
  blobB: { bottom: 100, right: -120, width: 380, height: 380 },
}));
