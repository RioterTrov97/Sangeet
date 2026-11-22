import type { SFSymbol } from 'expo-symbols';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { LAYOUTS, LAYOUT_LABELS } from '../player/layout';
import { setTvLayoutChoice, useRemote } from '../remote/phone';
import type { RemoteLayout } from '../remote/protocol';
import { tvStatus, type LyricsChip, type VideoChip } from '../remote/tvStatus';
import { tap } from './haptic';
import { openActionSheet } from './sheet';

/** SF Symbol of each TV layout (the same six the TV's layout pill shows). */
export const LAYOUT_SYMBOL: Record<RemoteLayout, SFSymbol> = {
  video: 'play.rectangle.fill',
  videoLyrics: 'rectangle.split.2x1.fill',
  videoLyricsOverlay: 'rectangle.inset.filled',
  musicLyrics: 'music.note.list',
  music: 'music.note',
  lyrics: 'quote.bubble.fill',
};
const VIDEO_SYMBOL: Record<VideoChip['icon'], SFSymbol> = { music: 'play.rectangle.fill', lyric: 'text.bubble.fill', upload: 'arrow.up.circle.fill', none: 'video.slash', failed: 'exclamationmark.triangle.fill' };
const LYRICS_SYMBOL: Record<LyricsChip['icon'], SFSymbol> = { synced: 'quote.bubble.fill', plain: 'text.alignleft', none: 'quote.bubble', unsure: 'exclamationmark.circle', hidden: 'eye.slash' };

/** Opens the layout chooser: picking one changes the layout on the TV. */
export function openLayoutChooser(current: RemoteLayout): void {
  openActionSheet({
    title: 'TV layout',
    actions: LAYOUTS.map((l) => ({ id: `layout:${l}`, label: LAYOUT_LABELS[l], icon: LAYOUT_SYMBOL[l], checked: l === current, onPress: () => setTvLayoutChoice(l) })),
  });
}

/**
 * "On TV" status strip: icons that mirror what the TV is doing (its layout, the video it chose, the lyrics, the quality). The phone
 * never plays the video itself; the artwork stays and this says what the TV shows. Tap the layout to change it.
 */
export function OnTvStrip({ color, dim, accent }: { color: string; dim: string; accent: string }) {
  const tvName = useRemote((r) => r.tvName);
  const conn = useRemote((r) => r.status);
  const layout = useRemote((r) => r.tvLayout);
  const info = useRemote((r) => r.tvInfo);
  const st = tvStatus(layout, info);
  const lostColor = '#f5a623';
  return (
    <View style={styles.wrap} accessibilityLabel={`On ${tvName ?? 'TV'}: ${st.layoutLabel}, ${st.video.label}, ${st.lyrics.label}${st.quality ? `, ${st.quality}` : ''}`}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: conn === 'connected' ? accent : lostColor }]} />
        <Text style={[styles.headText, { color: dim }]} numberOfLines={1}>
          {conn === 'connected' ? `On ${tvName ?? 'TV'}` : `${tvName ?? 'TV'}: reconnecting`}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable onPress={() => { tap(); openLayoutChooser(st.layout); }} style={[styles.chip, styles.chipOn]} accessibilityRole="button" accessibilityLabel={`TV layout: ${st.layoutLabel}. Change`}>
          <SymbolView name={LAYOUT_SYMBOL[st.layout]} size={16} tintColor={color} />
          <Text style={[styles.chipText, { color }]} numberOfLines={1}>{st.layoutLabel}</Text>
          <SymbolView name="chevron.up.chevron.down" size={10} tintColor={dim} />
        </Pressable>
        <View style={styles.chip}>
          {st.video.spinner ? <ActivityIndicator size="small" color={color} /> : <SymbolView name={VIDEO_SYMBOL[st.video.icon]} size={16} tintColor={st.video.icon === 'failed' ? lostColor : st.video.icon === 'none' ? dim : color} />}
          <Text style={[styles.chipText, { color: st.video.icon === 'none' ? dim : color }]} numberOfLines={1}>{st.video.label}</Text>
        </View>
        <View style={styles.chip}>
          {st.lyrics.spinner ? <ActivityIndicator size="small" color={color} /> : <SymbolView name={LYRICS_SYMBOL[st.lyrics.icon]} size={16} tintColor={st.lyrics.dim ? dim : st.lyrics.icon === 'unsure' ? lostColor : color} />}
          <Text style={[styles.chipText, { color: st.lyrics.dim ? dim : color }]} numberOfLines={1}>{st.lyrics.label}</Text>
        </View>
        {st.quality ? (
          <View style={styles.chip}>
            <SymbolView name="slider.horizontal.3" size={14} tintColor={dim} />
            <Text style={[styles.chipText, { color: dim }]} numberOfLines={1}>{st.quality}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 6, marginTop: theme.spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.spacing.xl },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  headText: { ...theme.typography.caption, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.spacing.xl },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  chipOn: { backgroundColor: 'rgba(255,255,255,0.18)' },
  chipText: { ...theme.typography.caption, fontWeight: '600' },
}));
