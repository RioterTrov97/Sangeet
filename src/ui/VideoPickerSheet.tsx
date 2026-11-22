import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { chooseTvVideo, useRemote } from '../remote/phone';
import { watchVideo } from '../video/controller';
import { useVideoPicker, videoThumb, type PickerRow } from '../video/picker';
import type { Track } from '../youtube/models';
import { tap } from './haptic';
import { openCustomSheet } from './sheet';

/** "Choose video": the best few candidates for the song with preview, channel, length, views and what kind of video each is. */
export const openVideoPicker = (track: Track) => openCustomSheet((close) => <PickerBody track={track} close={close} />, { title: 'Choose video' });

function PickerBody({ track, close }: { track: Track; close: () => void }) {
  const { theme } = useUnistyles();
  const local = useVideoPicker(track);
  // Controlling a TV: the choice goes to the TV, which is the authority and shows it; the list is the phone's own lookup.
  const tvOn = useRemote((r) => r.status !== 'off');
  const tvVideoId = useRemote((r) => r.tvInfo?.videoId);
  const tvKnown = tvOn && tvVideoId !== undefined;
  const p = tvOn
    ? {
        ...local,
        rows: tvKnown ? local.rows.map((r) => ({ ...r, current: r.id === tvVideoId })) : local.rows,
        none: tvKnown ? tvVideoId === null : local.none,
        choose: (id: string) => chooseTvVideo(track.id, id),
        noVideo: () => chooseTvVideo(track.id, 'none'),
        reset: () => chooseTvVideo(track.id, null),
      }
    : local;
  const done = (fn: () => void) => () => {
    tap();
    fn();
    close();
  };
  return (
    <View style={styles.wrap}>
      {p.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.note}>Looking for videos...</Text>
        </View>
      ) : p.rows.length ? (
        p.rows.map((r) => <Row key={r.id} r={r} onPress={done(() => (p.choose(r.id), tvOn ? undefined : void watchVideo(track)))} />)
      ) : (
        <Text style={styles.note}>No matching video found for this song.</Text>
      )}
      <Action icon="video.slash" label="No video for this song" checked={p.none} onPress={done(p.noVideo)} />
      <Action icon="arrow.clockwise" label={p.checking ? 'Checking...' : 'Check again'} onPress={() => (tap(), p.check())} />
      {p.overridden ? <Action icon="arrow.uturn.backward" label="Reset to automatic" onPress={done(p.reset)} /> : null}
    </View>
  );
}

function Row({ r, onPress }: { r: PickerRow; onPress: () => void }) {
  const { theme } = useUnistyles();
  const meta = [r.channel, r.duration, r.views].filter(Boolean).join(' · ');
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${r.title}, ${r.badge}`} accessibilityState={{ selected: r.current }}>
      <Image source={{ uri: videoThumb(r.id) }} style={styles.thumb} contentFit="cover" />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {r.title}
        </Text>
        <View style={styles.metaLine}>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
          {r.verified ? <SymbolView name="checkmark.seal.fill" size={12} tintColor={theme.colors.textSecondary} /> : null}
        </View>
        <Text style={[styles.badge, r.badge === 'Music video' && { color: theme.colors.accent }]}>{r.badge}</Text>
      </View>
      {r.current ? <SymbolView name="checkmark" size={16} tintColor={theme.colors.accent} /> : null}
    </Pressable>
  );
}

function Action({ icon, label, onPress, checked }: { icon: 'video.slash' | 'arrow.clockwise' | 'arrow.uturn.backward'; label: string; onPress: () => void; checked?: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={20} tintColor={theme.colors.accent} style={styles.icon} />
      <Text style={styles.actionText}>{label}</Text>
      {checked ? <SymbolView name="checkmark" size={16} tintColor={theme.colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: 10 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  note: { color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: 10, borderRadius: 16, backgroundColor: theme.colors.surfaceElevated },
  thumb: { width: 112, height: 63, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  text: { flex: 1, gap: 2 },
  title: { color: theme.colors.text, ...theme.typography.body, fontWeight: '600' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flexShrink: 1, color: theme.colors.textSecondary, ...theme.typography.caption },
  badge: { color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '700' },
  action: { height: 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, borderRadius: 16, backgroundColor: theme.colors.surfaceElevated },
  icon: { width: 24, height: 24 },
  actionText: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
}));
