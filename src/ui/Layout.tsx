import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { Artwork as ArtworkModel } from '../youtube/models';
import { Artwork } from './Artwork';
import { IconButton } from './Controls';
import { Glass } from './Glass';
import { layout } from './theme';
export { Screen, SheetScreen, useScreenTop } from './Screen';

const HEADER_ROW = 48;

/** Layer 1 of a tab header: the title row. Layer 2 (chips / search field) is `TAB_BAR_H` tall, with ~12 pt of air below. */
export const TAB_TITLE_H = 56;
export const TAB_BAR_H = 60;
/** Offset a tab screen's scrolling content reserves at its top for <TabHeader>. */
export function useTabTop(hasBar: boolean): number {
  return useUnistyles().rt.insets.top + TAB_TITLE_H + (hasBar ? TAB_BAR_H : 0);
}

const SLIDE_MS = 220;
/** Scroll distance over which a header's glass fades in. */
const GLASS_FADE = 24;

/** The glass surface behind a header: invisible at rest, fades in with `scrollY` (0 -> GLASS_FADE px) and carries a hairline. */
function HeaderGlass({ scrollY, style }: { scrollY: SharedValue<number>; style: unknown }) {
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, GLASS_FADE], [0, 1], Extrapolation.CLAMP) }));
  return (
    <Animated.View style={[styles.glassWrap, style as object, fade]} pointerEvents="none">
      <Glass radius={0} style={StyleSheet.absoluteFill} intensity={60} tint="rgba(18,18,18,0.35)" />
      <View style={styles.hairline} />
    </Animated.View>
  );
}

/**
 * Detail-page bar, pinned under the status bar: back, a title and the page's actions. Transparent at rest; once content
 * scrolls under it a glass surface (status bar included) fades in. Hero pages show a small title that fades in once the hero
 * has scrolled off (`threshold`); list pages pass `inline` and always show the title beside the back chevron.
 */
export function Header({ title, scrollY, back, right, threshold = 48, titleInset, fadeRight, inline }: { title: string; scrollY: SharedValue<number>; back?: boolean; right?: ReactNode; threshold?: number; /** Left margin for the title when a floating back button sits over the bar. */ titleInset?: number; /** Fade the right slot in with the title (when the hero already shows it). */ fadeRight?: boolean; /** Always-visible bold title next to the back chevron (plain list pages). */ inline?: boolean }) {
  const { rt } = useUnistyles();
  const fade = useAnimatedStyle(() => ({ opacity: inline ? 1 : interpolate(scrollY.value, [0, threshold], [0, 1], Extrapolation.CLAMP) }));
  return (
    <>
      <HeaderGlass scrollY={scrollY} style={{ height: rt.insets.top + layout.headerBar }} />
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.headerRow}>
          {back ? <IconButton name="chevron.left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))} /> : null}
          <Animated.Text style={[inline ? styles.inlineTitle : styles.headerTitle, fade, titleInset ? { marginLeft: titleInset } : null]} numberOfLines={1} accessibilityRole="header">
            {title}
          </Animated.Text>
          <Animated.View style={[styles.headerRight, fadeRight && fade]} pointerEvents={fadeRight ? 'box-none' : 'auto'}>{right}</Animated.View>
        </View>
      </View>
    </>
  );
}

/**
 * Two-layer header for the main tabs. Layer 1 (avatar, big title, page actions) scrolls away on the way down and returns as
 * soon as the user scrolls up. Layer 2 (`bar`: chips, search field) stays pinned under the status bar. Transparent at rest;
 * a glass surface behind both layers (and the status bar) fades in with scroll and shrinks to the status bar + layer 2 while
 * layer 1 is away. The list below must reserve `useTabTop(!!bar)` at its top.
 */
export function TabHeader({ title, scrollY, left, right, bar }: { title: string; scrollY: SharedValue<number>; left?: ReactNode; right?: ReactNode; bar?: ReactNode }) {
  const { rt } = useUnistyles();
  const top = rt.insets.top;
  const barH = bar ? TAB_BAR_H : 0;
  const shown = useSharedValue(1);
  const lastY = useSharedValue(0);
  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      const dy = y - lastY.value;
      if (y <= TAB_TITLE_H) shown.value = 1;
      else if (dy > 6) shown.value = 0;
      else if (dy < -6) shown.value = 1;
      if (Math.abs(dy) > 6 || y <= TAB_TITLE_H) lastY.value = y;
    },
  );
  // 1 = title row visible, 0 = hidden; drives the glass height, the clip height and the row's slide together.
  const p = useDerivedValue(() => withTiming(shown.value, { duration: SLIDE_MS }));
  const glassH = useAnimatedStyle(() => ({ height: top + barH + p.value * TAB_TITLE_H }));
  const clip = useAnimatedStyle(() => ({ height: barH + p.value * TAB_TITLE_H }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: (p.value - 1) * TAB_TITLE_H }] }));
  return (
    <>
      <HeaderGlass scrollY={scrollY} style={glassH} />
      <Animated.View style={[styles.tabClip, { top }, clip]} pointerEvents="box-none">
        <Animated.View style={slide} pointerEvents="box-none">
          <View style={styles.tabTitleRow}>
            {left}
            <Text style={styles.large} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            {right ? <View style={styles.headerRight}>{right}</View> : null}
          </View>
          {bar ? <View style={styles.tabBar}>{bar}</View> : null}
        </Animated.View>
      </Animated.View>
    </>
  );
}

/** Section title (+ optional action) used above shelves and lists. */
export function SectionTitle({ title, action, onAction, first }: { title: string; action?: string; onAction?: () => void; /** Directly under the header bar: no extra top gap. */ first?: boolean }) {
  return (
    <View style={[styles.sectionRow, first && styles.sectionFirst]}>
      <Text style={styles.section} accessibilityRole="header">
        {title}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.action}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Square (or round) artwork with a title and one caption line. */
export function Card({ art, title, subtitle, size = 140, round, onPress, onLongPress, label }: { art: ArtworkModel[]; title: string; subtitle?: string; size?: number; round?: boolean; onPress: () => void; /** Opens the item's action sheet. */ onLongPress?: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={{ width: size }} accessibilityRole="button" accessibilityLabel={label ?? [title, subtitle].filter(Boolean).join(', ')}>
      <Artwork art={art} size={size} round={round} />
      <Text style={[styles.cardTitle, round && styles.center]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.cardSub, round && styles.center]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Artwork-tinted gradient that fades into the page background. */
export function TintedBackground({ color, height = 380 }: { color: string; height?: number }) {
  return <LinearGradient colors={[color, '#121212']} style={[styles.tint, { height }]} pointerEvents="none" />;
}

const styles = StyleSheet.create((theme, rt) => ({
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 11, paddingTop: rt.insets.top },
  glassWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, overflow: 'hidden' },
  tabClip: { position: 'absolute', left: 0, right: 0, zIndex: 11, overflow: 'hidden' },
  tabTitleRow: { height: TAB_TITLE_H, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg },
  tabBar: { height: TAB_BAR_H, justifyContent: 'center', paddingBottom: 12 },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)' },
  headerRow: { height: HEADER_ROW, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg },
  headerTitle: { flex: 1, color: theme.colors.text, ...theme.typography.heading },
  inlineTitle: { flex: 1, color: theme.colors.text, ...theme.typography.title },
  headerRight: { flexDirection: 'row', gap: theme.spacing.lg },
  large: { flex: 1, color: theme.colors.text, ...theme.typography.display },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.md },
  sectionFirst: { paddingTop: theme.spacing.sm },
  section: { color: theme.colors.text, ...theme.typography.title },
  action: { color: theme.colors.textSecondary, ...theme.typography.body },
  cardTitle: { color: theme.colors.text, ...theme.typography.body, marginTop: theme.spacing.sm },
  cardSub: { color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 },
  center: { textAlign: 'center' },
  tint: { position: 'absolute', top: 0, left: 0, right: 0 },
}));
