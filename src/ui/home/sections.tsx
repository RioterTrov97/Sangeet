import { useEffect, useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { LayoutAnimation, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuth } from '../../auth/store';
import { useLibraryStore } from '../../library/store';
import { Icon } from '../Icon';

import { dedupeInto } from '../../home/layout';
import { freshOnly, newFromFollowed } from '../../home/personalize';
import { playTracks } from '../../player';
import { playSong } from '../playSong';
import type { Album, MusicItem, Playlist, Track } from '../../youtube/models';
import type { Mood } from '../../youtube/api';
import { useBecause, useCharts, useFollowedReleases, useMoodShelf } from '../../youtube/queries';
import { logWarn } from '../../util/log';
import { playEntry, trackSheet } from '../actions';
import { Card, SectionTitle } from '../Layout';
import { Shelf } from '../Shelf';
import { Skeleton } from '../States';
import { TrackRow } from '../TrackRow';
import type { Personal } from './usePersonal';

/** Logs a failed shelf once, then the shelf hides itself. */
function useLogOnce(failed: boolean, what: string, err: unknown) {
  const reason = err instanceof Error ? err.message : String(err);
  useEffect(() => {
    if (failed) logWarn('home', `${what} failed, hiding shelf: ${reason}`);
  }, [failed, what, reason]);
}

/** About the height of a loaded shelf (title, 140 px cards, two caption lines): the placeholder and the shelf swap without moving what is below. */
const SHELF_H = 250;

function ShelfSkeleton() {
  return (
    <View style={styles.skel}>
      <Skeleton width={160} height={22} />
      <View style={styles.skelRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 6 }}>
            <Skeleton width={140} height={140} />
            <Skeleton width={110} height={14} />
            <Skeleton width={70} height={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

export type SectionId = 'topSongs' | 'newReleases' | 'videos' | 'popularArtists' | 'charts' | 'mood' | 'followedNew' | 'recent' | 'artists' | 'mixes' | 'because' | 'library';

/** Pre-computed (cross-shelf de-duplicated) content handed down by HomeScreen. */
export type HomeContent = { topSongs: Track[]; newReleases: Album[]; videos: MusicItem[]; recent: Track[]; exclude: Set<string>; loading: boolean };

export function HomeSection({ id, personal, content, seed, mood }: { id: SectionId; personal: Personal; content: HomeContent; seed?: Track; mood?: Mood }) {
  switch (id) {
    case 'topSongs':
      return <TopSongs songs={content.topSongs} loading={content.loading} />;
    case 'newReleases':
      return content.loading ? <ShelfSkeleton /> : <Shelf title="New releases" items={content.newReleases} source="home-new" />;
    case 'videos':
      return content.loading ? <ShelfSkeleton /> : <Shelf title="Trending videos" items={content.videos} source="home-videos" />;
    case 'popularArtists':
    case 'charts':
      return <ChartsSection id={id} />;
    case 'mood':
      return mood ? <MoodSection mood={mood} exclude={content.exclude} /> : null;
    case 'followedNew':
      return <FollowedNew personal={personal} exclude={content.exclude} />;
    case 'recent':
      return <Shelf title="Recently played" items={content.recent} source="home-recent" />;
    case 'artists':
      return <Shelf title="Your artists" items={personal.artistItems.slice(0, 12)} source="home-artists" />;
    case 'mixes':
      return <Mixes personal={personal} />;
    case 'library':
      return <LibraryShelves />;
    case 'because':
      return seed ? <Because seed={seed} recent={personal.recent} exclude={content.exclude} /> : null;
  }
}

export const TOP_DEFAULT = 3;

/** Title, three track rows and the Show more link, like the loaded list. */
function TopSongsSkeleton() {
  return (
    <View style={styles.skel}>
      <Skeleton width={160} height={22} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skelTrack}>
          <Skeleton width={48} height={48} />
          <View style={{ gap: 6 }}>
            <Skeleton width={180} height={14} />
            <Skeleton width={110} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Top songs: 3 rows, "Show more" expands inline (animated) to the full list, "Show less" collapses. */
function TopSongs({ songs, loading }: { songs: Track[]; loading: boolean }) {
  const [all, setAll] = useState(false);
  if (loading) return <TopSongsSkeleton />;
  if (!songs.length) return null;
  const shown = all ? songs : songs.slice(0, TOP_DEFAULT);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'opacity'));
    setAll((v) => !v);
  };
  return (
    <View>
      <SectionTitle title="Top songs" />
      {shown.map((t, i) => (
        <TrackRow key={t.id} track={t} index={i} onPress={() => playSong(songs, i, { source: 'home-top' })} />
      ))}
      {songs.length > TOP_DEFAULT ? (
        <Pressable onPress={toggle} style={styles.more} hitSlop={8} accessibilityRole="button" accessibilityLabel={all ? 'Show less top songs' : 'Show more top songs'}>
          <Text style={styles.moreText}>{all ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Popular artists (circles) and chart playlists from the Charts page. */
function ChartsSection({ id }: { id: 'popularArtists' | 'charts' }) {
  const q = useCharts();
  useLogOnce(q.isError, 'charts', q.error);
  if (q.isLoading) return <ShelfSkeleton />;
  if (!q.data) return null;
  return id === 'popularArtists' ? <Shelf title="Popular artists" items={q.data.artists.slice(0, 20)} source="home-charts" /> : <Shelf title="Top playlists" items={q.data.playlists} source="home-charts" />;
}

/** Playlists for one mood / genre tile (Chill, Workout, Party, regional genre). */
function MoodSection({ mood, exclude }: { mood: Mood; exclude: Set<string> }) {
  const q = useMoodShelf(mood);
  useLogOnce(q.isError, `mood ${mood.title}`, q.error);
  const items = useMemo(() => (q.shelf ? dedupeInto(q.shelf.items, new Set(exclude), { min: 4 }) : []), [q.shelf, exclude]);
  if (q.isLoading) return <ShelfSkeleton />;
  return q.shelf ? <Shelf title={q.shelf.title} items={items} source={`home-mood-${mood.title}`} /> : null;
}

/** Latest releases of followed artists (cached ~12h per artist); hidden until something recent shows up. */
function FollowedNew({ personal, exclude }: { personal: Personal; exclude: Set<string> }) {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const { releases } = useFollowedReleases(personal.followed, signedIn ? 16 : 8); // signed in: subscriptions are followed artists too
  const items = useMemo(() => dedupeInto(newFromFollowed(releases, new Date().getFullYear() - 1), new Set(exclude), { min: 2 }), [releases, exclude]);
  return <Shelf title="New from artists you follow" items={items} source="home-followed" />;
}

function Because({ seed, recent, exclude }: { seed: Track; recent: Track[]; exclude: Set<string> }) {
  const q = useBecause(seed.id);
  useLogOnce(q.isError, `because ${seed.id}`, q.error);
  const items = useMemo(() => dedupeInto(freshOnly(q.data ?? [], seed.id, recent), new Set(exclude), { min: 4 }), [q.data, seed.id, recent, exclude]);
  if (q.isLoading) return <ShelfSkeleton />;
  return <Shelf title={`Because you listened to ${seed.title}`} items={items} source="home-because" />;
}

/** Radio mixes seeded by the top artists; tapping plays the seed track and the player continues with its radio. */
function Mixes({ personal }: { personal: Personal }) {
  const mixes = personal.artists.slice(0, 6);
  if (mixes.length < 2) return null;
  return (
    <View>
      <SectionTitle title="Mixes for you" />
      <FlashList
        horizontal
        data={mixes}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Gap}
        keyExtractor={(m) => m.id}
        renderItem={({ item: m }) => (
          <Card art={m.topTrack.artwork} size={140} title={`${m.name} Mix`} subtitle="Radio" onPress={() => void playTracks([m.topTrack], 0, { source: 'home-mix' })} label={`${m.name} Mix, radio`} onLongPress={() => trackSheet(m.topTrack)} />
        )}
      />
    </View>
  );
}

const LIKED_SHOWN = 15;

/** Signed in: the saved playlists and the first liked songs, each hidden with fewer than two items. */
function LibraryShelves() {
  const saved = useLibraryStore((s) => s.saved);
  const liked = useLibraryStore((s) => s.liked);
  const playlists = useMemo(() => saved.filter((x): x is Playlist => x.kind === 'playlist'), [saved]);
  const likedShown = useMemo(() => liked.slice(0, LIKED_SHOWN), [liked]);
  return (
    <View>
      {playlists.length >= 2 ? <Shelf title="Your playlists" items={playlists} source="home-playlists" /> : null}
      {likedShown.length >= 2 ? <Shelf title="Liked songs" items={likedShown} source="home-liked" action="See all" onAction={() => router.push('/liked')} /> : null}
    </View>
  );
}

/** Full-width "Your Supermix" card: plays the account's supermix playlist from the start, radio continuing after it. */
export function SupermixButton({ playlist }: { playlist: Playlist }) {
  const { theme } = useUnistyles();
  return (
    <Pressable style={({ pressed }) => [styles.supermix, pressed && styles.pressed]} onPress={() => void playEntry(playlist)} accessibilityRole="button" accessibilityLabel="Play your Supermix, endless mix made for you">
      <View style={styles.supermixText}>
        <Text style={styles.supermixTitle}>Your Supermix</Text>
        <Text style={styles.supermixSub}>Endless mix made for you</Text>
      </View>
      <Icon name="play.fill" size={20} tintColor={theme.colors.accent} />
    </Pressable>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: theme.spacing.lg },
  gap: { width: theme.spacing.md },
  skel: { height: SHELF_H, padding: theme.spacing.lg, gap: theme.spacing.md },
  skelTrack: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  skelRow: { flexDirection: 'row', gap: theme.spacing.md },
  supermix: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceElevated },
  supermixText: { flex: 1, gap: 2 },
  supermixTitle: { color: theme.colors.text, ...theme.typography.heading },
  supermixSub: { color: theme.colors.textSecondary, ...theme.typography.caption },
  pressed: { opacity: 0.7 },
  more: { alignSelf: 'center', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  moreText: { color: theme.colors.textSecondary, ...theme.typography.heading },
}));
