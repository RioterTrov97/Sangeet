import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { downloadTracks, removeDownload, retryDownload, progressOf, useDownloads, type GroupInfo } from '../downloads/manager';
import { toggleSaved, useIsSaved, useLibraryStore, type SavedItem } from '../library/store';
import { addToQueue, playTracks } from '../player';
import { formatDuration } from '../player/format';
import { pickArtwork } from '../youtube/mappers/common';
import type { Artwork as ArtworkModel, Track } from '../youtube/models';
import { useAlbum, usePlaylist } from '../youtube/queries';
import { Artwork } from './Artwork';
import { CollectionDownloadButton } from './DownloadButton';
import { useArtworkColor } from './artworkColor';
import { IconButton, PlayButton } from './Controls';
import { tap } from './haptic';
import { Header, Screen, TintedBackground, useScreenTop } from './Layout';
import { usePalette } from './palette/store';
import { LikedTile } from './LibraryScreen';
import { AnimatedFlashList, useScrollY } from './scroll';
import { ErrorState, Skeleton } from './States';
import { layout } from './theme';
import { playSong } from './playSong';
import { TrackRow } from './TrackRow';

/** `?play=all|shuffle|<index>` lets simulator verification start playback via deep link. */
function useAutoPlay(tracks: Track[], source: string) {
  const { play } = useLocalSearchParams<{ play?: string }>();
  useEffect(() => {
    if (!play || !tracks.length) return;
    if (play === 'all') void playTracks(tracks, 0, { source });
    else if (play === 'shuffle') void playTracks(tracks, 0, { source, shuffle: true });
    else void playTracks(tracks, Number(play), { source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, tracks.length > 0]);
}

function Loading({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  const scrollY = useScrollY().scrollY;
  const topInset = useScreenTop('header');
  return (
    <Screen top="header">
      <Header title="" scrollY={scrollY} back />
      {error ? (
        <View style={styles.center}>
          <ErrorState message="Could not load" onRetry={onRetry} />
        </View>
      ) : (
        <View style={[styles.skel, { paddingTop: topInset + 16 }]}>
          <Skeleton width={220} height={220} style={styles.skelArt} />
          <Skeleton width="60%" height={26} />
          <Skeleton width="40%" height={14} />
        </View>
      )}
    </Screen>
  );
}

type CollectionProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  art: ArtworkModel[];
  liked?: boolean;
  tracks: Track[];
  source: string;
  save?: SavedItem;
  link?: string;
  onEnd?: () => void;
  loadingMore?: boolean;
  showIndex?: boolean;
  group?: GroupInfo;
  /** Resolves the complete track list (paged playlists) before downloading. */
  loadAll?: () => Promise<Track[]>;
};

/** Album / Playlist / Liked: tinted header with artwork that shrinks on scroll, action row, track list. */
function CollectionScreen(p: CollectionProps) {
  const { scrollY, onScroll } = useScrollY();
  const tint = useArtworkColor(pickArtwork(p.art, 200));
  const [shuffle, setShuffle] = useState(false);
  const [sort, setSort] = useState<'default' | 'title' | 'artist'>('default');
  const palette = usePalette();
  const shown = useMemo(() => {
    if (sort === 'default') return p.tracks;
    const key = (t: Track) => (sort === 'title' ? t.title : (t.artists[0]?.name ?? '')).toLowerCase();
    return [...p.tracks].sort((a, b) => key(a).localeCompare(key(b)));
  }, [p.tracks, sort]);
  const topInset = useScreenTop('header');
  const saved = useIsSaved(p.save?.kind ?? 'album', p.save?.id);
  const byId = useDownloads((s) => s.byId);
  const dl = { ...progressOf(p.tracks, byId), total: p.tracks.length };
  const downloadAll = async () => {
    tap();
    const all = p.loadAll ? await p.loadAll() : p.tracks;
    downloadTracks(all, p.group);
  };
  /** Starts at `index` of what is shown now; for paged playlists the rest is queued behind it once all pages are in. */
  const playFrom = (index: number, openPlayer = false) => {
    if (openPlayer) playSong(shown, index, { source: p.source, sourceName: p.title, shuffle });
    else void playTracks(shown, index, { source: p.source, sourceName: p.title, shuffle });
    if (p.loadAll && p.onEnd) {
      const have = new Set(shown.map((t) => t.id));
      void p.loadAll().then((all) => all.filter((t) => !have.has(t.id)).forEach((t) => void addToQueue(t))).catch(() => {});
    }
  };
  const playAll = () => {
    tap();
    playFrom(0);
  };
  const artStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 220], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(scrollY.value, [-100, 0, 220], [1.15, 1, 0.65], Extrapolation.CLAMP) }],
  }));

  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={shown}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(t: Track, i: number) => `${t.id}-${i}`}
        onEndReachedThreshold={0.5}
        onEndReached={p.onEnd}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <TintedBackground color={p.liked ? '#4500F5' : tint} height={420} />
            <View style={[styles.hero, { paddingTop: topInset + layout.heroGap }]}>
              <Animated.View style={[styles.heroArt, artStyle]}>
                {p.liked ? <LikedTile size={220} count={p.tracks.length} /> : <Artwork art={p.art} size={220} style={styles.shadow} />}
              </Animated.View>
              <Text style={styles.overline}>{p.liked ? 'PLAYLIST' : p.save?.kind === 'album' || p.showIndex ? 'ALBUM' : 'PLAYLIST'}</Text>
              <Text style={styles.title} numberOfLines={3} accessibilityRole="header">
                {p.title}
              </Text>
              {p.subtitle || p.meta ? <Text style={styles.sub}>{[p.subtitle, p.meta].filter(Boolean).join(' • ')}</Text> : null}
              <View style={styles.actions}>
                <View style={styles.actionsLeft}>
                  <IconButton name="shuffle" size={26} color={shuffle ? palette.accent : '#fff'} active={shuffle} label={shuffle ? 'Shuffle on' : 'Shuffle off'} onPress={() => setShuffle(!shuffle)} />
                  {p.save ? <IconButton name={saved ? 'heart.fill' : 'heart'} size={24} active={saved} label={saved ? 'Remove from library' : 'Save to library'} onPress={() => toggleSaved(p.save!)} /> : null}
                </View>
                <PlayButton size={64} onPress={playAll} label="Play" fill={palette.accent} iconColor={palette.onAccent} />
              </View>
              <View style={styles.pills}>
                <CollectionDownloadButton
                  pill="Offline"
                  tint={palette.accent}
                  status={dl}
                  label={p.title}
                  onDownload={() => void downloadAll()}
                  onRemove={() => p.tracks.forEach((t) => removeDownload(t.id))}
                  onRetry={() => p.tracks.forEach((t) => retryDownload(t.id))}
                />
                <Pressable style={styles.pill} onPress={() => (tap(), setSort(sort === 'default' ? 'title' : sort === 'title' ? 'artist' : 'default'))} accessibilityRole="button" accessibilityLabel={`Sort: ${sort}`}>
                  <SymbolView name="arrow.up.arrow.down" size={14} weight="semibold" tintColor="#fff" />
                  <Text style={styles.pillText}>{sort === 'default' ? 'Sort' : sort === 'title' ? 'By title' : 'By artist'}</Text>
                </Pressable>
                <Pressable style={styles.pill} onPress={() => p.link && void Share.share({ message: p.link })} accessibilityRole="button" accessibilityLabel="Share">
                  <SymbolView name="square.and.arrow.up" size={14} weight="semibold" tintColor="#fff" />
                  <Text style={styles.pillText}>Share</Text>
                </Pressable>
              </View>
            </View>
          </View>
        }
        renderItem={({ item, index }: { item: Track; index: number }) => (
          <TrackRow track={item} index={p.showIndex === false ? undefined : index} fallbackArt={p.art} onPress={() => playFrom(index, true)} />
        )}
        ListFooterComponent={p.loadingMore ? <Skeleton height={48} style={styles.more} /> : <View style={styles.footer} />}
      />
      <Header title={p.title} scrollY={scrollY} back threshold={240} />
    </Screen>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const totalTime = (tracks: Track[]) => {
  const s = tracks.reduce((a, t) => a + (t.durationSec ?? 0), 0);
  return s ? formatDuration(s) : undefined;
};

export function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isError, refetch } = useAlbum(id);
  useAutoPlay(data?.tracks ?? [], `album:${id}`);
  if (!data) return <Loading error={isError} onRetry={() => void refetch()} />;
  const { album, tracks } = data;
  return (
    <CollectionScreen
      title={album.title}
      subtitle={album.artists.map((a) => a.name).join(', ')}
      meta={[album.releaseType, album.year, plural(tracks.length, 'song'), totalTime(tracks)].filter(Boolean).join(' • ')}
      art={album.artwork}
      tracks={tracks}
      source={`album:${id}`}
      save={album}
      group={{ kind: 'album', id, name: album.title }}
      link={`https://music.youtube.com/browse/${id}`}
      showIndex
    />
  );
}

export function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { playlist, tracks, isError, hasNextPage, fetchNextPage, isFetchingNextPage, refetch, countText } = usePlaylist(id);
  useAutoPlay(tracks, `playlist:${id}`);
  if (!playlist) return <Loading error={isError} onRetry={() => void refetch()} />;
  return (
    <CollectionScreen
      title={playlist.title}
      subtitle={playlist.author}
      meta={[countText ?? plural(tracks.length, 'song'), totalTime(tracks)].filter(Boolean).join(' • ')}
      art={playlist.artwork}
      tracks={tracks}
      source={`playlist:${id}`}
      save={playlist}
      group={{ kind: 'playlist', id, name: playlist.title }}
      loadAll={async () => {
        let more = hasNextPage;
        let cur = tracks;
        while (more) {
          const next = await fetchNextPage();
          cur = next.data?.pages.flatMap((pg) => pg.page.items) ?? cur;
          more = !!next.hasNextPage;
        }
        return cur;
      }}
      link={`https://music.youtube.com/playlist?list=${id}`}
      onEnd={() => hasNextPage && !isFetchingNextPage && void fetchNextPage()}
      loadingMore={isFetchingNextPage}
    />
  );
}

export function LikedScreen() {
  const liked = useLibraryStore((s) => s.liked);
  return <CollectionScreen title="Liked Songs" subtitle="Playlist" meta={plural(liked.length, 'song')} art={[]} liked tracks={liked} source="liked" showIndex={false} group={{ kind: 'liked', id: 'liked', name: 'Liked Songs' }} />;
}


export { ArtistScreen } from './ArtistScreen';


const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  skel: { flex: 1, alignItems: 'center', gap: theme.spacing.md },
  skelArt: { marginBottom: theme.spacing.lg },
  listContent: { paddingBottom: theme.spacing.xl },
  hero: { alignItems: 'flex-start', paddingHorizontal: theme.spacing.lg, gap: theme.spacing.xs },
  heroArt: { alignSelf: 'center', marginBottom: theme.spacing.lg },
  shadow: { borderRadius: 4 },
  overline: { color: theme.colors.textSecondary, ...theme.typography.caption, letterSpacing: 1.2, marginTop: theme.spacing.sm },
  title: { color: theme.colors.text, ...theme.typography.display, fontSize: 32, lineHeight: 38 },
  sub: { color: theme.colors.textSecondary, ...theme.typography.body },
  pills: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  pillText: { color: '#fff', ...theme.typography.heading, fontSize: 14, lineHeight: 18 },
  meta: { color: theme.colors.textSecondary, ...theme.typography.body },
  actions: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.spacing.md },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xl },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
  more: { margin: theme.spacing.lg },
  footer: { height: theme.spacing.xl },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 180 },
  artistName: { position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, bottom: theme.spacing.md, color: theme.colors.text, ...theme.typography.display, fontSize: 36, lineHeight: 42 },
  artistActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg },
  showMore: { color: theme.colors.textSecondary, ...theme.typography.heading, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
}));
