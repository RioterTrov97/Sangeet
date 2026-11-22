import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { downloadTracks, progressOf, removeDownload, retryDownload, useDownloads } from '../downloads/manager';
import { deleteLocalPlaylist, localPlaylistTracks, removeFromLocalPlaylist, renameLocalPlaylist, reorderLocalPlaylist, useLibraryStore } from '../library/store';
import { playTracks } from '../player';
import { playSong } from './playSong';
import { CollectionDownloadButton } from './DownloadButton';
import { IconButton, PlayButton } from './Controls';
import { Header, Screen, useScreenTop } from './Layout';
import { layout } from './theme';
import { PlaylistCover } from './PlaylistCover';
import { AnimatedFlashList, useScrollY } from './scroll';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';
import { tap } from './haptic';
import { confirmSheet } from './sheet';
import type { Track } from '../youtube/models';

/** A user-made playlist stored in SQLite: rename, delete, remove / reorder tracks, play, download. */
export function LocalPlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const meta = useLibraryStore((s) => s.playlists.find((p) => p.id === id));
  const rev = useLibraryStore((s) => s.playlistsRev);
  const tracks = useMemo(() => (meta ? localPlaylistTracks(id) : []), [id, meta, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState(false);
  const byId = useDownloads((s) => s.byId);
  const dl = { ...progressOf(tracks, byId), total: tracks.length };
  if (!meta) return <Screen top="header"><Header title="" scrollY={scrollY} back /><EmptyState icon="music.note.list" title="Playlist not found" /></Screen>;

  const rename = () => Alert.prompt('Rename playlist', undefined, (n) => n?.trim() && renameLocalPlaylist(id, n), 'plain-text', meta.name);
  const remove = () =>
    confirmSheet({ title: `Delete "${meta.name}"?`, text: 'The songs stay in your library; only this playlist is removed.', label: 'Delete playlist', onConfirm: () => (deleteLocalPlaylist(id), router.back()) });
  const play = (shuffle = false, i = 0) => void playTracks(tracks, i, { source: `local:${id}`, sourceName: meta.name, shuffle });
  const playRow = (i: number) => playSong(tracks, i, { source: `local:${id}`, sourceName: meta.name });

  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={tracks}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(t: Track) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={[styles.hero, { paddingTop: topInset + layout.heroGap }]}>
            <PlaylistCover art={meta.art} size={200} />
            <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
              {meta.name}
            </Text>
            <Text style={styles.meta}>{`Playlist • ${meta.count} song${meta.count === 1 ? '' : 's'}`}</Text>
            <View style={styles.actions}>
              <View style={styles.row}>
                <IconButton name="pencil" size={22} label="Rename playlist" onPress={rename} />
                <IconButton name={edit ? 'checkmark.circle.fill' : 'arrow.up.arrow.down'} size={22} active={edit} label={edit ? 'Done reordering' : 'Reorder songs'} onPress={() => setEdit(!edit)} />
                <IconButton name="trash" size={22} label="Delete playlist" onPress={remove} />
                <CollectionDownloadButton status={dl} label={meta.name} onDownload={() => downloadTracks(tracks, { kind: 'playlist', id: `local:${id}`, name: meta.name })} onRemove={() => tracks.forEach((t) => removeDownload(t.id))} onRetry={() => tracks.forEach((t) => retryDownload(t.id))} />
              </View>
              <View style={styles.row}>
                <IconButton name="shuffle" size={24} label="Shuffle" onPress={() => (tap(), play(true))} />
                <PlayButton size={56} onPress={() => (tap(), play())} />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={<EmptyState art="rows" icon="music.note.list" tone="playlist" title="This playlist is empty" body="Use the menu on any song and choose Add to playlist." action={{ label: 'Find songs', onPress: () => router.push('/(tabs)/search' as never) }} />}
        renderItem={({ item, index }: { item: Track; index: number }) => (
          <View style={styles.item}>
            <View style={styles.flex}>
              <TrackRow track={item} onPress={() => playRow(index)} />
            </View>
            {edit ? (
              <View style={styles.row}>
                <IconButton name="chevron.up" size={18} label={`Move ${item.title} up`} onPress={() => reorderLocalPlaylist(id, index, index - 1)} style={index === 0 && styles.dim} />
                <IconButton name="chevron.down" size={18} label={`Move ${item.title} down`} onPress={() => reorderLocalPlaylist(id, index, index + 1)} style={index === tracks.length - 1 && styles.dim} />
                <IconButton name="minus.circle" size={20} color="#e5484d" label={`Remove ${item.title}`} onPress={() => removeFromLocalPlaylist(id, item.id)} />
              </View>
            ) : null}
          </View>
        )}
      />
      <Header title={meta.name} scrollY={scrollY} back threshold={220} />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { paddingBottom: theme.spacing.xl },
  hero: { alignItems: 'flex-start', paddingHorizontal: theme.spacing.lg, gap: theme.spacing.xs },
  title: { color: theme.colors.text, ...theme.typography.display, marginTop: theme.spacing.md },
  meta: { color: theme.colors.textSecondary, ...theme.typography.body },
  actions: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
  item: { flexDirection: 'row', alignItems: 'center', paddingRight: theme.spacing.lg },
  flex: { flex: 1 },
  dim: { opacity: 0.3 },
}));
