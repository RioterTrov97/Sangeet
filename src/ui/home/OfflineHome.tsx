import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { autoCachedTracks } from '../../downloads/autoCache';
import { downloadedTracks } from '../../downloads/manager';
import { offlineSongs } from '../../downloads/offline';
import { localTracks } from '../../local';
import { playOfflineSongs } from '../../player';
import type { Track } from '../../youtube/models';
import { EMPTY_TONES, withAlpha } from '../emptyTones';
import { playSong } from '../playSong';
import { TrackRow } from '../TrackRow';

/** Offline Home rows: a hero card, then short lists of downloaded and automatically saved songs. */
export type OfflineRow =
  | { type: 'offlineHero'; count: number }
  | { type: 'offlineHead'; title: string; count: number; more: boolean }
  | { type: 'offlineSong'; track: Track; list: Track[]; key: string };

const DEVICE_TITLE = 'On this iPhone';
const SHOWN = { downloaded: 5, saved: 8, device: 5 };

export function offlineRows(): OfflineRow[] {
  const downloaded = downloadedTracks();
  const saved = autoCachedTracks();
  const device = localTracks();
  const rows: OfflineRow[] = [{ type: 'offlineHero', count: offlineSongs(downloaded, saved, device).length }];
  const section = (title: string, list: Track[], n: number, tag: string) => {
    if (!list.length) return;
    rows.push({ type: 'offlineHead', title, count: list.length, more: list.length > n });
    for (const t of list.slice(0, n)) rows.push({ type: 'offlineSong', track: t, list, key: `${tag}-${t.id}` });
  };
  section('Downloaded', downloaded, SHOWN.downloaded, 'd');
  section('Saved from listening', saved, SHOWN.saved, 's');
  section(DEVICE_TITLE, device, SHOWN.device, 'l');
  return rows;
}

export const isOfflineRow = (r: { type: string }): r is OfflineRow => r.type.startsWith('offline');

export function OfflineRowView({ row }: { row: OfflineRow }) {
  if (row.type === 'offlineHero') return <OfflineHero count={row.count} />;
  if (row.type === 'offlineHead') {
    return (
      <View style={styles.head}>
        <Text style={styles.headTitle}>{row.title}</Text>
        {row.more ? (
          <Pressable onPress={() => router.push((row.title === DEVICE_TITLE ? '/on-device' : '/downloads') as never)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${row.count} ${row.title.toLowerCase()} songs`}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const i = Math.max(0, row.list.findIndex((t) => t.id === row.track.id));
  return <TrackRow track={row.track} onPress={() => playSong(row.list, i, { source: 'downloads' })} />;
}

const TONE = EMPTY_TONES.offline.color;

function OfflineHero({ count }: { count: number }) {
  const body = count
    ? `${count} song${count === 1 ? ' is' : 's are'} saved on this device and play without a connection.`
    : 'Nothing is saved yet. Songs you download or play are kept on this device so they work offline.';
  return (
    <View style={[styles.hero, { borderColor: withAlpha(TONE, 0.28), backgroundColor: withAlpha(TONE, 0.1) }]}>
      <View style={styles.heroTop}>
        <View style={[styles.icon, { backgroundColor: withAlpha(TONE, 0.2) }]}>
          <SymbolView name="wifi.slash" size={20} tintColor={TONE} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>{"You're offline"}</Text>
          <Text style={styles.heroBody}>{body}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        {count ? (
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => void playOfflineSongs()} accessibilityRole="button" accessibilityLabel="Shuffle offline songs">
            <SymbolView name="shuffle" size={15} tintColor="#000" />
            <Text style={styles.primaryText}>Shuffle offline songs</Text>
          </Pressable>
        ) : null}
        <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => router.push('/downloads' as never)} accessibilityRole="button" accessibilityLabel="Open downloads">
          <SymbolView name="arrow.down.circle" size={15} tintColor="#fff" />
          <Text style={styles.secondaryText}>Downloads</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // marginTop: the gap other tabs leave under their chip bar (bar 60 - padding 12 - chip 36, centred: 18), so the card sits as content does there.
  hero: { marginTop: 18, marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.lg, padding: theme.spacing.lg, borderRadius: theme.radii.lg, borderWidth: 1, gap: theme.spacing.lg },
  heroTop: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1, gap: 2 },
  heroTitle: { color: theme.colors.text, ...theme.typography.title },
  heroBody: { color: theme.colors.textSecondary, ...theme.typography.body },
  buttons: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radii.full, backgroundColor: theme.colors.accent },
  primaryText: { color: '#000', ...theme.typography.body, fontFamily: theme.typography.heading.fontFamily },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radii.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  secondaryText: { color: theme.colors.text, ...theme.typography.body, fontFamily: theme.typography.heading.fontFamily },
  pressed: { opacity: 0.7 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xs },
  headTitle: { color: theme.colors.text, ...theme.typography.title },
  seeAll: { color: theme.colors.textSecondary, ...theme.typography.body },
}));
