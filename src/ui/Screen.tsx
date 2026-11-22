import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { usePlayerStore } from '../player/store';
import { containerTop, contentTop, sheetTopInset, type TopMode } from './insets';
import { MiniPlayer } from './MiniPlayer';
import { usePalette, usePaletteStore } from './palette/store';

/** Offset a screen's scrolling content must reserve at its top for `mode` (0 when the container already pads). Call it in the component that renders <Screen top={mode}>. */
export function useScreenTop(mode: TopMode): number {
  return contentTop(mode, useSafeAreaInsets().top);
}

/**
 * The one page base: owns the status-bar / header / sheet top spacing so screens never compute it themselves.
 * `top` picks the mode (see TopMode); content reads `useScreenTop()` for its leading offset.
 */
export function Screen({ children, top = 'safe', mini, style, glow = top === 'safe' || top === 'under' }: { children: ReactNode; top?: TopMode; mini?: boolean; style?: StyleProp<ViewStyle>; /** Faint now-playing glow at the top. */ glow?: boolean }) {
  const { top: safe } = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: containerTop(top, safe) }, style]}>
        {glow ? <AmbientGlow /> : null}
        {children}
        {mini ? <MiniPlayer bottomInset /> : null}
      </View>
  );
}

/** Modal presented from the player/sign-in: a card sheet starts below the status bar, so only a small gap is added. */
export function SheetScreen({ children, fullScreen = false, style }: { children: ReactNode; /** Set when the presenter shows it edge-to-edge instead of as a card sheet. */ fullScreen?: boolean; style?: StyleProp<ViewStyle> }) {
  const { top: safe, bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: sheetTopInset(fullScreen, safe), paddingBottom: bottom }, style]}>{children}</View>
  );
}

/** Faint now-playing glow at the top of tab screens: palette accent, <= 25 % opacity, gone by ~280 pt. */
function AmbientGlow() {
  const palette = usePalette();
  const playing = usePlayerStore((s) => !!s.queue[s.index]);
  const on = usePaletteStore((s) => s.matchColors);
  if (!playing || !on) return null;
  return <LinearGradient pointerEvents="none" colors={[`${palette.accent}40`, `${palette.accent}00`]} style={styles.glow} />;
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },
}));
