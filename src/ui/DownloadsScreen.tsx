import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { autoCachedTracks, clearAutoCache, useAutoCache } from '../downloads/autoCache';
import { autoUsage } from '../downloads/format';
import { downloadedGroups, downloadedTracks, removeAllDownloads, useDownloads } from '../downloads/manager';
import { useDownloadSettings } from '../downloads/settings';
import { playTracks } from '../player';
import { playSong } from './playSong';
import type { Track } from '../youtube/models';
import { Artwork } from './Artwork';
import { confirmAction, openActionSheet } from './sheet';
import { Header, Screen, useScreenTop } from './Layout';
import { openAlbum, openPlaylist } from './nav';
import { AnimatedFlashList, useScrollY } from './scroll';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';
import { router } from 'expo-router';

type Row =
  | { type: 'header'; title: string; sub?: string }
  | { type: 'shuffle' }
  | { type: 'group'; kind: string; id: string; name: string; count: number; art: Track['artwork'] }
  | { type: 'song'; track: Track; list: 'manual' | 'auto' }
  | { type: 'note'; text: string };

/** Downloads: what you downloaded yourself, and the songs saved automatically as you play. The ⋯ menu clears either. */
export function DownloadsScreen() {
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const { theme } = useUnistyles();
  const dlRev = useDownloads((s) => s.rev);
  const autoIds = useAutoCache((s) => s.ids);
  const autoBytes = useAutoCache((s) => s.bytes);
  const budget = useDownloadSettings((s) => s.autoCacheMb);

  const { rows, manual } = useMemo(() => {
    const songs = downloadedTracks();
    const byId = new Map(songs.map((t) => [t.id, t]));
    const groups = downloadedGroups().map((g) => ({ type: 'group' as const, kind: g.kind, id: g.id, name: g.name, count: g.trackIds.length, art: byId.get(g.trackIds[0])?.artwork ?? [] }));
    const auto = autoCachedTracks();
    if (!songs.length && !groups.length && !auto.length) return { rows: [] as Row[], manual: songs };
    const out: Row[] = [{ type: 'header', title: 'Downloaded', sub: songs.length ? `${songs.length} song${songs.length === 1 ? '' : 's'}` : undefined }];
    if (!songs.length) out.push({ type: 'note', text: 'Songs, albums and playlists you download show up here.' });
    else out.push({ type: 'shuffle' }, ...groups, ...songs.map((track) => ({ type: 'song' as const, track, list: 'manual' as const })));
    out.push({ type: 'header', title: 'Saved automatically', sub: autoUsage(autoBytes, budget) });
    if (!auto.length) out.push({ type: 'note', text: budget > 0 ? 'Songs you play are kept here so they work offline.' : 'Automatic saving is off. Turn it on in Settings.' });
    else out.push(...auto.map((track) => ({ type: 'song' as const, track, list: 'auto' as const })));
    return { rows: out, manual: songs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlRev, autoIds, autoBytes, budget]);

  const menu = (
    <Pressable
      style={styles.more}
      onPress={() =>
        openActionSheet({
          header: { title: 'Downloads', subtitle: 'Songs saved on this device' },
          actions: [
            confirmAction({ id: 'clearauto', label: 'Clear saved automatically', icon: 'arrow.down.circle', destructive: false, title: 'Clear automatically saved songs?', text: 'They are removed from this device and stream again next time. Songs you downloaded yourself are kept.', confirmLabel: 'Clear', onConfirm: clearAutoCache }),
            confirmAction({ id: 'removeall', label: 'Remove all downloads', icon: 'trash', title: 'Remove all downloads?', text: 'Every song, album and playlist you downloaded is deleted from this device. This cannot be undone.', confirmLabel: 'Remove all', onConfirm: removeAllDownloads }),
          ],
        })
      }
      accessibilityRole="button"
      accessibilityLabel="More options for downloads">
      <SymbolView name="ellipsis.circle" size={24} tintColor={theme.colors.text} />
    </Pressable>
  );

  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={rows}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        keyExtractor={(r: Row, i: number) => (r.type === 'song' ? `${r.list}-${r.track.id}` : r.type === 'group' ? `g-${r.kind}-${r.id}` : `${r.type}-${i}`)}
        getItemType={(r: Row) => r.type}
        ListEmptyComponent={<EmptyState art="rows" icon="arrow.down.circle" tone="downloads" title="No downloads yet" body="Download songs and albums to listen without a connection." action={{ label: 'Browse music', onPress: () => router.navigate('/(tabs)/search' as never) }} />}
        renderItem={({ item: r }: { item: Row }) => {
          if (r.type === 'header')
            return (
              <View style={styles.headRow}>
                <Text style={styles.head} accessibilityRole="header">{r.title}</Text>
                {r.sub ? <Text style={styles.headSub}>{r.sub}</Text> : null}
              </View>
            );
          if (r.type === 'note') return <Text style={styles.note}>{r.text}</Text>;
          if (r.type === 'shuffle')
            return (
              <Pressable style={styles.row} onPress={() => void playTracks(manual, 0, { source: 'downloads', shuffle: true })} accessibilityRole="button" accessibilityLabel="Shuffle all downloaded songs">
                <View style={styles.shuffleIcon}>
                  <SymbolView name="shuffle" size={22} tintColor="#000" />
                </View>
                <Text style={styles.rowTitle}>Shuffle all</Text>
              </Pressable>
            );
          if (r.type === 'group')
            return (
              <Pressable style={styles.row} onPress={() => (r.kind === 'album' ? openAlbum(r.id) : r.id.startsWith('local:') ? router.push({ pathname: '/local/[id]', params: { id: r.id.slice(6) } }) : openPlaylist(r.id))} accessibilityRole="button" accessibilityLabel={`${r.name}, ${r.kind === 'album' ? 'album' : 'playlist'}, ${r.count} downloaded`}>
                <Artwork art={r.art} size={56} />
                <View style={styles.text}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{`${r.kind === 'album' ? 'Album' : 'Playlist'} • ${r.count} downloaded`}</Text>
                </View>
              </Pressable>
            );
          const list = r.list === 'manual' ? manual : autoCachedTracks();
          return <TrackRow track={r.track} onPress={() => playSong(list, Math.max(0, list.findIndex((t) => t.id === r.track.id)), { source: 'downloads' })} />;
        }}
      />
      <Header title="Downloads" scrollY={scrollY} back inline right={menu} />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  more: { padding: 2 },
  headRow: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm, gap: 2 },
  head: { color: theme.colors.text, ...theme.typography.title },
  headSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  note: { color: theme.colors.textSecondary, ...theme.typography.body, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  text: { flex: 1 },
  rowTitle: { color: theme.colors.text, ...theme.typography.bodyLarge },
  rowSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  shuffleIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
}));
