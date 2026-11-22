import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import { toggleFollow, toggleSaved, useIsFollowing, useIsSaved, useLibraryStore } from '../library/store';
import { Artwork } from '../ui/Artwork';
import { usePalette } from '../ui/palette/store';
import { useArtworkPalette } from '../ui/palette/useArtworkPalette';
import { pickArtwork } from '../youtube/mappers/common';
import type { Artwork as ArtworkModel, Track } from '../youtube/models';
import { useAlbum, useArtist, usePlaylist } from '../youtube/queries';
import { ActionButton, ButtonGrid, GRID_GAP, SAFE_X, SAFE_Y, TrackCard, TrackGridStatic, playAndOpen, useGridWidth } from './grid';
import { Row } from './ui';
import { useTvWindow } from './scale';
import { tv } from './theme';
import { EmptyStateTV } from './EmptyStateTV';
import { tvNav } from './nav';

const COLS = 2;

/** Album / playlist / liked / mood page: a fixed palette-tinted info column on the left and a two-column track grid on the right. */
function Collection({ id, art, overline, title, meta, tracks, source, name, buttons, empty }: { id: string; art: ArtworkModel[]; overline: string; title: string; meta?: string; tracks: Track[]; source: string; name?: string; buttons: ReactNode; empty?: ReactNode }) {
  const fallback = usePalette();
  const pal = useArtworkPalette(id, art) ?? fallback;
  const { width } = useTvWindow();
  const leftW = Math.round((width - tv.rail) * 0.32);
  const gridW = useGridWidth(leftW - SAFE_X + 20);
  const cw = Math.floor((gridW - GRID_GAP * (COLS - 1)) / COLS);
  const artSize = Math.min(300, leftW - 28 - 36);
  const play = useCallback((i: number) => playAndOpen(tracks, i, source, name), [tracks, source, name]);
  const renderTrack = useCallback(({ item, index }: { item: Track; index: number }) => <TrackCard track={item} index={index} width={cw} onPress={play} />, [cw, play]);
  return (
    <View style={st.split}>
      <LinearGradient colors={[pal.bg, pal.bgDeep]} style={[st.tint, { width: leftW + tv.rail }]} />
      <LinearGradient pointerEvents="none" colors={[`${pal.bg}66`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.7 }} style={[st.rightTint, { left: leftW }]} />
      <View style={[st.left, { width: leftW }]}>
        <Artwork art={art} size={artSize} style={{ borderRadius: 12 }} />
        <Text style={st.overline}>{overline}</Text>
        <Text style={st.title} numberOfLines={3}>
          {title}
        </Text>
        {meta ? (
          <Text style={st.meta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        <View style={{ marginTop: 14 }}>
          <ButtonGrid width={leftW - 28 - 36}>{buttons}</ButtonGrid>
        </View>
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={tracks}
        numColumns={COLS}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ paddingTop: SAFE_Y, paddingBottom: 60, paddingLeft: 20, paddingRight: SAFE_X, gap: GRID_GAP }}
        initialNumToRender={14}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={60}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={empty ? <View style={st.emptyBox}>{empty}</View> : undefined}
        renderItem={renderTrack}
      />
    </View>
  );
}

function Loading({ error }: { error?: boolean }) {
  return <View style={st.center}>{error ? <Text style={st.empty}>Could not load this page</Text> : <ActivityIndicator size="large" color="#fff" />}</View>;
}

export function AlbumTV({ id }: { id: string }) {
  const { data, isError } = useAlbum(id);
  const saved = useIsSaved('album', id);
  if (!data) return <Loading error={isError} />;
  const { album, tracks } = data;
  const src = `album:${id}`;
  return (
    <Collection
      id={album.id}
      art={album.artwork}
      overline={(album.releaseType ?? 'Album').toUpperCase()}
      title={album.title}
      meta={[album.artists.map((a) => a.name).join(', '), album.year, data.trackCountText].filter(Boolean).join(' • ')}
      tracks={tracks}
      source={src}
      name={album.title}
      buttons={
        <>
          <ActionButton label="Play" icon="play" primary preferred onPress={() => playAndOpen(tracks, 0, src, album.title)} />
          <ActionButton label="Shuffle" icon="shuffle" onPress={() => playAndOpen(tracks, 0, src, album.title, true)} />
          <ActionButton label={saved ? 'Saved' : 'Save'} icon={saved ? 'heart' : 'heartOutline'} onPress={() => toggleSaved(album)} />
        </>
      }
    />
  );
}

export function PlaylistTV({ id }: { id: string }) {
  const q = usePlaylist(id);
  const saved = useIsSaved('playlist', id);
  // Pull the remaining pages in the background (capped) so Play/Shuffle cover the whole list.
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && q.tracks.length < 300) void q.fetchNextPage();
  }, [q.hasNextPage, q.isFetchingNextPage, q.tracks.length, q]);
  if (!q.playlist) return <Loading error={q.isError} />;
  const p = q.playlist;
  const src = `playlist:${id}`;
  return (
    <Collection
      id={p.id}
      art={p.artwork}
      overline="PLAYLIST"
      title={p.title}
      meta={[p.author, q.countText].filter(Boolean).join(' • ')}
      tracks={q.tracks}
      source={src}
      name={p.title}
      buttons={
        <>
          <ActionButton label="Play" icon="play" primary preferred onPress={() => playAndOpen(q.tracks, 0, src, p.title)} />
          <ActionButton label="Shuffle" icon="shuffle" onPress={() => playAndOpen(q.tracks, 0, src, p.title, true)} />
          <ActionButton label={saved ? 'Saved' : 'Save'} icon={saved ? 'heart' : 'heartOutline'} onPress={() => toggleSaved(p)} />
        </>
      }
    />
  );
}

export function LikedTV() {
  const liked = useLibraryStore((s) => s.liked);
  return (
    <Collection
      id="liked"
      art={liked[0]?.artwork ?? []}
      overline="PLAYLIST"
      title="Liked songs"
      meta={`${liked.length} songs`}
      tracks={liked}
      source="liked"
      name="Liked songs"
      empty={<EmptyStateTV art="rows" icon="heart" tone="liked" title="Songs you like live here" body="Press the heart on any song to save it here." action={{ label: 'Search for music', onPress: () => tvNav().root({ name: 'search' }) }} />}
      buttons={
        <>
          <ActionButton label="Play" icon="play" primary preferred onPress={() => playAndOpen(liked, 0, 'liked', 'Liked songs')} />
          <ActionButton label="Shuffle" icon="shuffle" onPress={() => playAndOpen(liked, 0, 'liked', 'Liked songs', true)} />
        </>
      }
    />
  );
}

export function ArtistTV({ id }: { id: string }) {
  const { data, isError } = useArtist(id);
  const following = useIsFollowing(id);
  const fallback = usePalette();
  const pal = useArtworkPalette(data?.artist.id, data?.artist.artwork) ?? fallback;
  const gridW = useGridWidth(0);
  if (!data) return <Loading error={isError} />;
  const { artist } = data;
  const src = `artist:${id}`;
  const popular = data.topSongs.slice(0, 10);
  const hero = pickArtwork(artist.artwork, 480);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      <View style={st.band}>
        {hero ? <Image source={{ uri: hero }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} blurRadius={36} contentFit="cover" /> : null}
        <LinearGradient colors={[`${pal.bg}88`, tv.bg]} style={StyleSheet.absoluteFill} />
        <View style={st.bandRow}>
          <Artwork art={artist.artwork} size={190} round />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={st.overline}>ARTIST</Text>
            <Text style={[st.title, { fontSize: 52, lineHeight: 60 }]} numberOfLines={2}>
              {artist.name}
            </Text>
            {artist.subtitle ? (
              <Text style={st.meta} numberOfLines={1}>
                {artist.subtitle}
              </Text>
            ) : null}
            <View style={st.bandButtons}>
              <ActionButton label="Play" icon="play" primary preferred onPress={() => playAndOpen(data.topSongs, 0, src, artist.name)} />
              <ActionButton label="Shuffle" icon="shuffle" onPress={() => playAndOpen(data.topSongs, 0, src, artist.name, true)} />
              <ActionButton label={following ? 'Following' : 'Follow'} icon={following ? 'heart' : 'heartOutline'} onPress={() => toggleFollow(artist)} />
            </View>
          </View>
        </View>
      </View>
      {popular.length ? (
        <View style={{ paddingHorizontal: SAFE_X }}>
          <Text style={st.section}>Popular</Text>
          <TrackGridStatic tracks={popular} width={gridW} onPlay={(i) => playAndOpen(data.topSongs, i, src, artist.name)} />
        </View>
      ) : null}
      <Row id={`artist-albums-${id}`} title="Albums" items={data.albums} />
      <Row id={`artist-singles-${id}`} title="Singles" items={data.singles} />
      {data.shelves
        .filter((s) => s.items.length)
        .slice(0, 4)
        .map((s, i) => (
          <Row key={`${s.title}-${i}`} id={`artist-${id}-${s.title}`} title={s.title} items={s.items} />
        ))}
      <Row id={`artist-related-${id}`} title="Fans might also like" items={data.related} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  split: { flex: 1, flexDirection: 'row' },
  tint: { position: 'absolute', left: -tv.rail, top: 0, bottom: 0 },
  rightTint: { position: 'absolute', right: 0, top: 0, bottom: 0 },
  left: { paddingTop: SAFE_Y, paddingLeft: 28, paddingRight: 36 },
  overline: { color: 'rgba(255,255,255,0.75)', fontFamily: tv.font.bold, fontSize: 18, letterSpacing: 2, marginTop: 16 },
  title: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 32, lineHeight: 38, marginTop: 4 },
  meta: { color: 'rgba(255,255,255,0.78)', fontFamily: tv.font.medium, fontSize: 20, marginTop: 6 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  empty: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  band: { height: 330, justifyContent: 'flex-end' },
  bandRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 36, paddingHorizontal: SAFE_X, paddingBottom: 26 },
  bandButtons: { flexDirection: 'row', gap: 14, marginTop: 14 },
  section: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28, marginBottom: 12 },
});
