import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { DropdownRow } from '../search/dropdown';
import { Icon } from './icons';
import { Focusable } from './ui';
import { tv } from './theme';

export const TV_FIELD_H = 76;
const ROW_H = 64;
const DIVIDER_H = 1;
const PAD_B = 12;
const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const CLEAR = '__clear__';

function CardRow({ index, disabled, icon, text, dim, onPress, label, onFocus, onBlur }: { index: number; disabled: boolean; icon?: 'history' | 'search'; text: string; dim?: boolean; onPress: () => void; label: string; onFocus: () => void; onBlur: () => void }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(40 + index * 35, withTiming(1, { duration: 180, easing: EASE })));
  }, [p, index]);
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: interpolate(p.value, [0, 1], [-6, 0]) }] }));
  return (
    <Animated.View style={style}>
      <Focusable onPress={onPress} label={label} disabled={disabled} dim={false} scale={1} style={st.row} focusedStyle={st.rowOn} onFocus={onFocus} onBlur={onBlur}>
        {(f) => (
          <>
            {icon ? <Icon name={icon} size={26} color={f ? '#000' : '#bbb'} /> : <View style={{ width: 26 }} />}
            <Text style={[st.text, dim && { color: tv.textDim }, f && { color: '#000' }]} numberOfLines={1}>
              {text}
            </Text>
          </>
        )}
      </Focusable>
    </Animated.View>
  );
}

/**
 * The TV search field grown into one card: this draws the card surface (behind the real field, which sits above it with a
 * transparent background while `onShown(true)`), a hairline under the field row, and the focusable rows. Everything is absolutely
 * positioned from the top of the field slot, so the field never moves.
 */
export function SearchCardTV({ open, ring, rows, canClear, onPick, onClear, onRowFocus, onRowBlur, onShown }: { open: boolean; ring: boolean; rows: DropdownRow[]; canClear: boolean; onPick: (t: string) => void; onClear: () => void; onRowFocus: () => void; onRowBlur: () => void; onShown: (shown: boolean) => void }) {
  const visible = open && rows.length > 0;
  const [mounted, setMounted] = useState(false);
  const [kept, setKept] = useState<{ rows: DropdownRow[]; canClear: boolean }>({ rows, canClear });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remember what to draw while closing
    if (visible) setKept({ rows, canClear });
  }, [visible, rows, canClear]);
  const shown = visible ? rows : kept.rows;
  const clear = visible ? canClear : kept.canClear;
  const count = shown.length + (clear ? 1 : 0);
  const target = TV_FIELD_H + DIVIDER_H + count * ROW_H + PAD_B;
  const p = useSharedValue(0);
  const h = useSharedValue(TV_FIELD_H);
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount, then animate open
      setMounted(true);
      onShown(true);
      p.set(withTiming(1, { duration: 220, easing: EASE }));
      h.set(withTiming(target, { duration: 220, easing: EASE }));
    } else if (mounted) {
      p.set(
        withTiming(0, { duration: 160, easing: EASE }, (done) => {
          if (done) runOnJS(setMounted)(false);
        }),
      );
      h.set(withTiming(TV_FIELD_H, { duration: 160, easing: EASE }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, target]);
  useEffect(() => {
    if (!mounted && !visible) onShown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const card = useAnimatedStyle(() => ({ height: h.value, borderRadius: interpolate(p.value, [0, 1], [TV_FIELD_H / 2, 28]) }));
  const body = useAnimatedStyle(() => ({ height: Math.max(0, h.value - TV_FIELD_H), opacity: interpolate(p.value, [0, 0.4, 1], [0, 0.4, 1]) }));
  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  if (!mounted && !visible) return null;
  return (
    <>
      <Animated.View pointerEvents="none" style={[st.scrim, scrim]} />
      <Animated.View pointerEvents="none" style={[st.card, ring && st.cardRing, card]} />
      <Animated.View style={[st.body, body]}>
        <View style={st.divider} />
        {shown.map((r, i) => (
          <CardRow key={`${r.kind}-${r.text}`} index={i} disabled={!visible} icon={r.kind === 'recent' ? 'history' : 'search'} text={r.kind === 'typed' ? `Search for "${r.text}"` : r.text} label={`Search ${r.text}`} onPress={() => onPick(r.text)} onFocus={onRowFocus} onBlur={onRowBlur} />
        ))}
        {clear ? <CardRow key={CLEAR} index={shown.length} disabled={!visible} text="Clear recent searches" dim label="Clear recent searches" onPress={onClear} onFocus={onRowFocus} onBlur={onRowBlur} /> : null}
      </Animated.View>
    </>
  );
}

const st = StyleSheet.create({
  scrim: { position: 'absolute', top: -200, left: -400, right: -400, height: 2400, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { position: 'absolute', top: 0, left: tv.gutter, right: tv.gutter, backgroundColor: '#262626', borderWidth: 3, borderColor: 'transparent' },
  cardRing: { borderColor: '#fff' },
  body: { position: 'absolute', top: TV_FIELD_H, left: tv.gutter, right: tv.gutter, overflow: 'hidden', paddingHorizontal: 12 },
  divider: { height: DIVIDER_H, marginHorizontal: 20, backgroundColor: 'rgba(255,255,255,0.10)' },
  row: { height: ROW_H - 4, marginTop: 4, borderRadius: 16, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  rowOn: { backgroundColor: '#fff' },
  text: { flex: 1, color: '#fff', fontFamily: tv.font.medium, fontSize: 22 },
});
