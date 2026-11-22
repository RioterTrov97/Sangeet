import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { usePalette } from './palette/store';

/** Live Reduce Transparency flag. */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => alive && setOn(v));
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

let liquid: boolean | undefined;
const hasLiquid = () => (liquid ??= (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})());

/**
 * One glass surface for floating chrome only (tab bar, mini-player, header on scroll, small pills). Never nest glass
 * in glass, never put long text behind it.
 * liquid glass (iOS 26+) -> GlassView; else dark BlurView; Reduce Transparency -> a solid elevated colour.
 */
export function Glass({ children, style, radius = 22, tint, interactive, intensity = 40, solid }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; tint?: string; interactive?: boolean; intensity?: number; solid?: string }) {
  const reduce = useReduceTransparency();
  const { theme } = useUnistyles();
  const palette = usePalette();
  const tintColor = tint ?? palette.glassTint;
  const base = [styles.base, { borderRadius: radius }, style];
  // Android has no live blur behind a view: a translucent layer would just show list text through the bar, so use a solid surface.
  if (reduce || Platform.OS === 'android') return <View style={[base, { backgroundColor: solid ?? theme.colors.surfaceElevated }]}>{children}</View>;
  if (hasLiquid()) {
    return (
      <GlassView glassEffectStyle="regular" tintColor={tintColor} isInteractive={interactive} colorScheme="dark" style={base}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={base}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  base: { overflow: 'hidden' },
}));
