import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';

import type { DropdownRow } from '../search/dropdown';

export const CARD_FIELD_H = 48;
const ROW_H = 48;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

function CardRow({ row, index, onPick, onRemove, onLongPress }: { row: DropdownRow; index: number; onPick: (t: string) => void; onRemove: (t: string) => void; onLongPress: () => void }) {
  const { theme } = useUnistyles();
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(40 + index * 35, withTiming(1, { duration: 180, easing: EASE })));
  }, [p, index]);
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: interpolate(p.value, [0, 1], [-6, 0]) }] }));
  return (
    <Animated.View style={[styles.row, style]}>
      <Pressable style={styles.rowMain} onPress={() => onPick(row.text)} onLongPress={row.kind === 'recent' ? onLongPress : undefined} accessibilityRole="button" accessibilityLabel={`Search ${row.text}`}>
        <Icon name={row.kind === 'recent' ? 'clock' : 'magnifyingglass'} size={16} tintColor={theme.colors.textSecondary} />
        <Text style={styles.rowText} numberOfLines={1}>
          {row.kind === 'typed' ? `Search for "${row.text}"` : row.text}
        </Text>
      </Pressable>
      {row.kind === 'recent' ? (
        <Pressable hitSlop={8} style={styles.remove} onPress={() => onRemove(row.text)} accessibilityRole="button" accessibilityLabel={`Remove ${row.text} from recent searches`}>
          <Icon name="xmark" size={14} tintColor={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/**
 * The search field grown into one card. The real field stays in the tab header (above this card in z-order, so it keeps focus and
 * the keyboard); while the card is shown the field's own background is off (`onShown`) and this card paints the one surface under
 * it, starting at the field's top (`top`, window y) with the field's height as top padding, then a hairline, then the rows.
 */
export function SearchCard({ open, top, rows, onPick, onRemove, onClearAll, onClose, onShown }: { open: boolean; top: number | null; rows: DropdownRow[]; onPick: (t: string) => void; onRemove: (t: string) => void; onClearAll: () => void; onClose: () => void; onShown: (shown: boolean) => void }) {
  const visible = open && top !== null && rows.length > 0;
  const [mounted, setMounted] = useState(false);
  // While closing, keep drawing the last rows / position (the parent has already emptied them or lost focus).
  const [kept, setKept] = useState<{ rows: DropdownRow[]; top: number }>({ rows, top: top ?? 0 });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember what to draw while closing
    if (visible) setKept({ rows, top: top ?? 0 });
  }, [visible, rows, top]);
  const shown = visible ? rows : kept.rows;
  const p = useSharedValue(0);
  const h = useSharedValue(CARD_FIELD_H);
  const target = CARD_FIELD_H + 1 + shown.length * ROW_H + 6;

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount, then animate open
      setMounted(true);
      onShown(true);
      p.set(withTiming(1, { duration: 220, easing: EASE }));
      h.set(withTiming(target, { duration: 220, easing: EASE }));
    } else if (mounted) {
      p.set(withTiming(0, { duration: 160, easing: EASE }, (done) => {
        if (done) runOnJS(setMounted)(false);
      }));
      h.set(withTiming(CARD_FIELD_H, { duration: 160, easing: EASE }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, target]);
  useEffect(() => {
    if (!mounted && !visible) onShown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const card = useAnimatedStyle(() => ({ height: h.value, borderRadius: interpolate(p.value, [0, 1], [CARD_FIELD_H / 2, 20]), backgroundColor: p.value > 0.02 ? '#404040' : '#363636' }));
  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  const body = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.4, 1], [0, 0.4, 1]) }));
  if (!mounted && !visible) return null;
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close suggestions" />
      </Animated.View>
      <Animated.View style={[styles.card, { top: visible ? (top ?? kept.top) : kept.top }, card]} pointerEvents="box-none">
        <View style={{ height: CARD_FIELD_H }} pointerEvents="none" />
        <Animated.View style={body}>
          <View style={styles.divider} />
          {shown.map((r, i) => (
            <CardRow key={`${r.kind}-${r.text}`} row={r} index={i} onPick={onPick} onRemove={onRemove} onLongPress={onClearAll} />
          ))}
        </Animated.View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: theme.spacing.lg, backgroundColor: 'rgba(255,255,255,0.10)' },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg },
  rowText: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
  remove: { paddingHorizontal: theme.spacing.lg, height: ROW_H, justifyContent: 'center' },
}));
