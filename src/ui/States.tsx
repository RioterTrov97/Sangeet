import type { SFSymbol } from 'expo-symbols';
import { Icon } from './Icon';
import { useEffect } from 'react';
import { Pressable, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { circleFill, EMPTY_DELAY_MS, EMPTY_FADE_MS, EMPTY_TONES, emptyMetrics, GHOST_ROWS, withAlpha, type EmptyTone } from './emptyTones';

/** Pulsing placeholder block (shimmer-lite: opacity pulse is cheaper than a moving gradient and reads the same). */
export function Skeleton({ width = '100%', height = 16, radius = 4, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1);
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: '#282828' }, a, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

export type EmptyAction = { label: string; onPress: () => void; kind?: 'primary' | 'secondary' };

/** Fade in + scale 0.96 -> 1 after a short delay, so the state does not flash while a list is still loading. */
function useEntrance() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(EMPTY_DELAY_MS, withTiming(1, { duration: EMPTY_FADE_MS, easing: Easing.out(Easing.cubic) }));
  }, [p]);
  return useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.96 + 0.04 * p.value }] }));
}

function Rings({ icon, tone }: { icon: SFSymbol; tone: EmptyTone }) {
  const m = emptyMetrics('phone');
  const color = EMPTY_TONES[tone].color;
  const box = m.ringOuter;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.ring, { width: m.ringOuter, height: m.ringOuter, borderColor: withAlpha(color, m.ringOuterAlpha) }]} />
      <View style={[styles.ring, { width: m.ringInner, height: m.ringInner, borderColor: withAlpha(color, m.ringInnerAlpha) }]} />
      <View style={{ width: m.circle, height: m.circle, borderRadius: m.circle / 2, backgroundColor: circleFill(tone), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={m.icon} tintColor={color} />
      </View>
    </View>
  );
}

function GhostRows({ icon, tone }: { icon: SFSymbol; tone: EmptyTone }) {
  const shimmer = useSharedValue(0.6);
  useEffect(() => {
    shimmer.value = withDelay(EMPTY_DELAY_MS, withTiming(1, { duration: 600 }));
  }, [shimmer]);
  const a = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  return (
    <View style={styles.ghostBox}>
      <Animated.View style={[styles.ghostStack, a]}>
        {GHOST_ROWS.map((r, i) => (
          <View key={i} style={[styles.ghostRow, { opacity: r.opacity }]}>
            <View style={styles.ghostArt} />
            <View style={{ gap: 5 }}>
              <View style={[styles.ghostBar, { width: r.bars[0], backgroundColor: '#2A2A2A' }]} />
              <View style={[styles.ghostBar, { width: r.bars[1], backgroundColor: '#222' }]} />
            </View>
          </View>
        ))}
      </Animated.View>
      <View style={[styles.badge, { backgroundColor: EMPTY_TONES[tone].color }]}>
        <Icon name={icon} size={20} tintColor="#fff" />
      </View>
    </View>
  );
}

export function EmptyState({ icon = 'music.note', title, body, tone = 'neutral', action, art = 'rings' }: { icon?: SFSymbol; title: string; body?: string; tone?: EmptyTone; action?: EmptyAction; art?: 'rings' | 'rows' }) {
  const enter = useEntrance();
  return (
    <Animated.View style={[styles.wrap, enter]}>
      <View accessible accessibilityLabel={[title, body].filter(Boolean).join('. ')} style={styles.col}>
        {art === 'rows' ? <GhostRows icon={icon} tone={tone} /> : <Rings icon={icon} tone={tone} />}
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
      </View>
      {action ? (
        <Pressable onPress={action.onPress} style={[styles.btn, action.kind === 'secondary' ? styles.btnSecondary : styles.btnPrimary]} accessibilityRole="button" accessibilityLabel={action.label}>
          <Text style={[styles.btnText, action.kind === 'secondary' && { color: '#fff' }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function ErrorState({ message = 'Something went wrong', onRetry }: { message?: string; onRetry?: () => void }) {
  return <EmptyState icon="exclamationmark.triangle" title={message} tone="error" action={onRetry ? { label: 'Retry', onPress: onRetry } : undefined} />;
}

const styles = StyleSheet.create((theme) => ({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xl, padding: theme.spacing.xxl },
  col: { alignItems: 'center', gap: theme.spacing.md },
  ring: { position: 'absolute', borderWidth: 1, borderRadius: 999 },
  title: { color: theme.colors.text, ...theme.typography.heading, textAlign: 'center', marginTop: theme.spacing.sm },
  body: { color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', maxWidth: 280 },
  btn: { paddingHorizontal: theme.spacing.xl, paddingVertical: 10, borderRadius: theme.radii.full },
  btnPrimary: { backgroundColor: theme.colors.text },
  btnSecondary: { borderWidth: 1, borderColor: '#555' },
  btnText: { color: '#000', ...theme.typography.heading },
  ghostBox: { width: 200, paddingTop: 14, paddingRight: 14 },
  ghostStack: { width: 200, gap: 12 },
  ghostRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ghostArt: { width: 30, height: 30, borderRadius: 5, backgroundColor: '#2A2A2A' },
  ghostBar: { height: 7, borderRadius: 4 },
  badge: { position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
}));
