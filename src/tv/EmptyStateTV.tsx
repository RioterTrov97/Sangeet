import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { circleFill, EMPTY_DELAY_MS, EMPTY_FADE_MS, EMPTY_TONES, emptyMetrics, GHOST_ROWS, withAlpha, type EmptyTone } from '../ui/emptyTones';
import { Icon, type IconName } from './icons';
import { Focusable } from './ui';
import { tv } from './theme';

const K = 140 / 88;

type Props = {
  icon: IconName;
  title: string;
  body?: string;
  tone?: EmptyTone;
  /** `rows` for empty song collections (Liked, History, Downloads, a playlist), `rings` for everything else. */
  art?: 'rings' | 'rows';
  /** Smaller, for panels (the queue). */
  compact?: boolean;
  action?: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; preferred?: boolean };
};

/** The TV empty state: ringed icon or ghost song rows, title, one line, optional button. Fades in after ~150 ms. */
export function EmptyStateTV({ icon, title, body, tone = 'neutral', art = 'rings', compact, action }: Props) {
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(p, { toValue: 1, duration: EMPTY_FADE_MS, delay: EMPTY_DELAY_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [p]);
  const color = EMPTY_TONES[tone].color;
  const z = compact ? 0.6 : 1;
  return (
    <Animated.View style={[st.wrap, compact && { padding: 12 }, { opacity: p, transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
      {art === 'rows' ? <Ghost icon={icon} color={color} /> : <Rings icon={icon} tone={tone} z={z} />}
      <Text style={[st.title, compact && { fontSize: 24, marginTop: 4 }]}>{title}</Text>
      {body ? <Text style={[st.body, compact && { fontSize: 18, maxWidth: 420 }]}>{body}</Text> : null}
      {action ? (
        <View style={{ marginTop: 14 }}>
          <Focusable onPress={action.onPress} preferred={action.preferred} label={action.label} scale={1.05} style={[st.btn, action.kind === 'secondary' ? st.btnSecondary : st.btnPrimary]} focusedStyle={st.btnFocus}>
            {(f) => <Text style={[st.btnText, { color: action.kind === 'secondary' && !f ? '#fff' : '#000' }]}>{action.label}</Text>}
          </Focusable>
        </View>
      ) : null}
    </Animated.View>
  );
}

function Rings({ icon, tone, z }: { icon: IconName; tone: EmptyTone; z: number }) {
  const m = emptyMetrics('tv');
  const color = EMPTY_TONES[tone].color;
  const s = (n: number) => Math.round(n * z);
  const box = s(m.ringOuter);
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[st.ring, { width: s(m.ringOuter), height: s(m.ringOuter), borderColor: withAlpha(color, m.ringOuterAlpha) }]} />
      <View style={[st.ring, { width: s(m.ringInner), height: s(m.ringInner), borderColor: withAlpha(color, m.ringInnerAlpha) }]} />
      <View style={{ width: s(m.circle), height: s(m.circle), borderRadius: s(m.circle) / 2, backgroundColor: circleFill(tone), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={s(m.icon)} color={color} />
      </View>
    </View>
  );
}

function Ghost({ icon, color }: { icon: IconName; color: string }) {
  return (
    <View style={{ width: 520 + 32, paddingTop: 32, paddingRight: 32 }}>
      <View style={{ gap: 24 }}>
        {GHOST_ROWS.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 20, opacity: r.opacity }}>
            <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#2A2A2A' }} />
            <View style={{ gap: 9 }}>
              <View style={{ width: r.bars[0] * K * 1.45, height: 12, borderRadius: 6, backgroundColor: '#2A2A2A' }} />
              <View style={{ width: r.bars[1] * K * 1.45, height: 10, borderRadius: 5, backgroundColor: '#222' }} />
            </View>
          </View>
        ))}
      </View>
      <View style={{ position: 'absolute', top: 0, right: 0, width: 64, height: 64, borderRadius: 32, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={32} color="#fff" />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 24 },
  ring: { position: 'absolute', borderWidth: 1, borderRadius: 999 },
  title: { color: tv.text, fontFamily: tv.font.medium, fontSize: 34, textAlign: 'center', marginTop: 12 },
  body: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24, textAlign: 'center', maxWidth: 720 },
  btn: { paddingHorizontal: 36, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#fff' },
  btnSecondary: { borderWidth: 1, borderColor: '#555' },
  btnFocus: { backgroundColor: '#fff' },
  btnText: { fontFamily: tv.font.bold, fontSize: 24 },
});
