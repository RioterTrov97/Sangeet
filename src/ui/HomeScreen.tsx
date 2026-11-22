import { useFloatingInset } from './floating';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAuth } from '../auth/store';
import { useAutoCache } from '../downloads/autoCache';
import { useDownloads } from '../downloads/manager';
import { useIsOffline } from '../downloads/net';
import { playSong } from './playSong';
import type { Album, MusicItem, Shelf as ShelfModel, Track } from '../youtube/models';
import { pickMoods } from '../home/discover';
import { dedupeInto, filterFeed, homeOrder, itemKey, mergeReleases, mixQuickPicks, ytQuickPicks } from '../home/layout';
import { boostLiked } from '../home/personalize';
import { logWarn } from '../util/log';
import type { Mood } from '../youtube/api';
import { deviceRegion, useExplore, useHome, useHomeMore, useMoods } from '../youtube/queries';
import { Artwork } from './Artwork';
import { itemSubtitle, itemTitle } from './itemText';
import { Screen, TabHeader, useTabTop } from './Layout';
import { AvatarMenu, HistoryButton } from './AvatarMenu';
import { Chip } from './Controls';
import { openItem } from './nav';
import { AnimatedFlashList, useScrollY } from './scroll';
import { Shelf } from './Shelf';
import { HomeSection, type HomeContent, type SectionId } from './home/sections';
import { usePersonal } from './home/usePersonal';
import { isOfflineRow, OfflineRowView, offlineRows, type OfflineRow } from './home/OfflineHome';

import { ErrorState, Skeleton } from './States';

const EMPTY_CONTENT: HomeContent = { topSongs: [], newReleases: [], videos: [], recent: [], exclude: new Set(), loading: true };

export function greeting(hour = new Date().getHours()): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type Row = OfflineRow | { type: 'quick'; items: MusicItem[] } | { type: 'banner'; kind: 'expired' } | { type: 'shelf'; shelf: ShelfModel } | { type: 'skeleton' } | { type: 'section'; id: SectionId; seed?: Track; mood?: Mood; key: string };

function QuickTile({ item }: { item: MusicItem }) {
  const sub = item.kind === 'track' || item.kind === 'artist' ? itemSubtitle(item) : undefined;
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
      onPress={() => (item.kind === 'track' ? playSong([item], 0, { source: 'home-quick' }) : openItem(item))}
      accessibilityRole="button"
      accessibilityLabel={[itemTitle(item), sub].filter(Boolean).join(', ')}>
      <Artwork art={item.artwork} size={56} style={styles.tileArt} round={item.kind === 'artist'} />
      <View style={styles.tileBody}>
        <Text style={styles.tileText} numberOfLines={sub ? 1 : 2}>
          {itemTitle(item)}
        </Text>
        {sub ? (
          <Text style={styles.tileSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function HomeScreen() {
  const floatInset = useFloatingInset();
  const { data, isLoading, isError, refetch } = useHome();
  // Spinner only for a pull: the launch refresh of the cached Home must not open the refresh control (on iOS it pushes the list down, then slides it back up).
  const [pulling, setPulling] = useState(false);
  const pullRefresh = () => {
    setPulling(true);
    void refetch().finally(() => setPulling(false));
  };
  const { scrollY, onScroll } = useScrollY();
  const offline = useIsOffline();
  const expired = useAuth((s) => s.status === 'expired');
  const dlRev = useDownloads((s) => s.rev);
  const savedBytes = useAutoCache((s) => s.bytes);
  const personal = usePersonal();
  const explore = useExplore();
  const moodTiles = useMoods().data;
  const moods = useMemo(() => pickMoods(moodTiles, deviceRegion(), 3), [moodTiles]);
  const more = useHomeMore(!!data && !offline);
  useEffect(() => {
    if (more.isError) logWarn('home', `home continuation failed, no more shelves: ${more.error instanceof Error ? more.error.message : more.error}`);
  }, [more.isError, more.error]);
  const ex = explore.data;
  const { rows, content } = useMemo<{ rows: Row[]; content: HomeContent }>(() => {
    if (offline) return { rows: offlineRows(), content: EMPTY_CONTENT };
    if (!data && isError && explore.isError) return { rows: [], content: EMPTY_CONTENT };
    const banner: Row[] = expired ? [{ type: 'banner', kind: 'expired' }] : [];
    const liked = personal.liked;
    const topSongs = boostLiked(ex?.topSongs ?? [], liked, 3).slice(0, 10);
    const top3 = new Set(topSongs.slice(0, 3).map(itemKey));
    const quick = mixQuickPicks({
      yt: ytQuickPicks(data),
      trending: [...(ex?.topSongs ?? []), ...(ex?.videos ?? [])],
      personalised: personal.personalised,
      recent: personal.recent,
      top: personal.artists.map((a) => a.topTrack),
      followed: personal.followed,
      avoid: top3,
    });
    // Everything shown so far; later shelves drop repeats (kept as-is when too little would remain).
    const seen = new Set<string>([...quick.map(itemKey), ...top3]);
    const recent = personal.personalised ? dedupeInto(personal.recent, seen, { min: 4 }) : [];
    const releases = mergeReleases(boostLiked(ex?.newAlbums?.length || ex?.newSingles?.length ? (ex?.newAlbums ?? []) : (ex?.newReleases ?? []).filter((i): i is Album => i.kind === 'album'), liked, 3), boostLiked(ex?.newSingles ?? [], liked, 3));
    const videos = dedupeInto(ex?.videos ?? [], seen, { min: 3 });
    for (const r of releases) seen.add(itemKey(r));
    const exclude = new Set(seen);
    const content: HomeContent = { topSongs, newReleases: releases, videos, recent, exclude, loading: !ex && !explore.isError };
    const sec = (id: SectionId, seed?: Track, mood?: Mood): Row => ({ type: 'section', id, seed, mood, key: `${id}-${seed?.id ?? mood?.title ?? ''}` });
    const feedShelves = data ? filterFeed([...data, ...more.shelves.filter((m) => !data.some((d) => d.title === m.title))], new Set(seen), ['Quick picks']) : [];
    const rows: Row[] = [...banner];
    if (quick.length) rows.push({ type: 'quick', items: quick });
    else if (isLoading) rows.push({ type: 'skeleton' });
    for (const id of homeOrder(personal.personalised, personal.followed.length > 0)) {
      if (id === 'quick') continue;
      if (id === 'recent') personal.personalised && recent.length >= 2 && rows.push(sec('recent'));
      else if (id === 'because') personal.personalised && personal.seeds.forEach((t) => rows.push(sec('because', t)));
      else if (id === 'mixes') personal.personalised && rows.push(sec('mixes'));
      else if (id === 'artists') (personal.personalised || personal.followed.length) && rows.push(sec('artists'));
      else if (id === 'mood') moods.slice(0, 3).forEach((m) => rows.push(sec('mood', undefined, m)));
      else if (id === 'feed') feedShelves.forEach((shelf) => rows.push({ type: 'shelf', shelf }));
      else rows.push(sec(id));
    }
    return { rows, content };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading, offline, expired, dlRev, savedBytes, personal, isError, explore.isError, ex, moods, more.shelves]);
  const topInset = useTabTop(!offline); // offline: no For you / Discover bar, so no room for it
  const [tab, setTab] = useState<'foryou' | 'discover'>('foryou');
  const shown = useMemo(() => (offline ? rows : rows.filter((r) => (r.type === 'section' && DISCOVER.has(r.id) ? tab === 'discover' : r.type === 'shelf' || r.type === 'quick' || r.type === 'section' || r.type === 'skeleton' ? tab === 'foryou' : true))), [rows, tab, offline]);
  return (
    <Screen top="under">
      <AnimatedFlashList
        data={shown}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset, paddingBottom: floatInset }]}
        refreshing={pulling}
        onRefresh={pullRefresh}
        onEndReached={() => more.hasNextPage && !more.isFetchingNextPage && void more.fetchNextPage()}
        onEndReachedThreshold={1.5}
        keyExtractor={(r: Row, i: number) => (r.type === 'shelf' ? `s-${r.shelf.title}-${i}` : r.type === 'section' ? `sec-${r.key}` : r.type === 'offlineSong' ? r.key : r.type === 'offlineHead' ? `h-${r.title}` : r.type)}
        getItemType={(r: Row) => (r.type === 'section' ? `section-${r.id}` : r.type)}
        ListEmptyComponent={isError && explore.isError ? <ErrorState message="Could not load Home" onRetry={() => void refetch()} /> : null}
        renderItem={({ item }: { item: Row }) =>
          isOfflineRow(item) ? (
            <OfflineRowView row={item} />
          ) : item.type === 'banner' ? (
            <Banner kind={item.kind} />
          ) : item.type === 'quick' ? (
            <View style={styles.grid}>
              {item.items.map((it) => (
                <QuickTile key={`${it.kind}-${it.id}`} item={it} />
              ))}
            </View>
          ) : item.type === 'section' ? (
            <HomeSection id={item.id} personal={personal} content={content} seed={item.seed} mood={item.mood} />
          ) : item.type === 'shelf' ? (
            <Shelf title={item.shelf.title} items={item.shelf.items} source="home" />
          ) : (
            <HomeSkeleton />
          )
        }
      />
      <TabHeader
        title={greeting()}
        scrollY={scrollY}
        left={<AvatarMenu />}
        right={<HistoryButton />}
        bar={
          offline ? undefined : (
            <View style={styles.chips}>
              <Chip label="For you" selected={tab === 'foryou'} onPress={() => setTab('foryou')} />
              <Chip label="Discover" selected={tab === 'discover'} onPress={() => setTab('discover')} />
            </View>
          )
        }
      />
    </Screen>
  );
}

function Banner(_: { kind: 'expired' }) {
  return (
    <Pressable style={[styles.banner, styles.bannerWarn]} onPress={() => router.push('/signin')} accessibilityRole="button" accessibilityLabel="Session expired, sign in again">
      <Text style={styles.bannerTitle}>Session expired, sign in again</Text>
      <Text style={styles.bannerBody}>Showing the anonymous Home. Tap to sign in.</Text>
    </Pressable>
  );
}

function HomeSkeleton() {
  return (
    <View>
      <View style={styles.grid}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width="48.5%" height={56} radius={4} />
        ))}
      </View>
      <View style={styles.skelShelf}>
        <Skeleton width={160} height={22} />
        <View style={styles.skelCards}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={140} height={140} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Home sections that belong to Discover (the trending / charts side); everything else is For you. */
const DISCOVER: ReadonlySet<string> = new Set(['topSongs', 'newReleases', 'videos', 'popularArtists', 'charts', 'mood']);

const styles = StyleSheet.create((theme) => ({
  chips: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  content: { paddingBottom: theme.spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  tile: { width: '48.5%', height: 56, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.radii.sm, overflow: 'hidden' },
  tilePressed: { opacity: 0.7 },
  tileArt: { borderRadius: 0 },
  tileBody: { flex: 1, paddingRight: theme.spacing.sm, justifyContent: 'center' },
  tileText: { color: theme.colors.text, ...theme.typography.caption, fontFamily: theme.typography.heading.fontFamily },
  tileSub: { color: theme.colors.textSecondary, ...theme.typography.caption, fontSize: 11, marginTop: 1 },
  banner: { marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceElevated, gap: 2 },
  bannerWarn: { borderWidth: 1, borderColor: theme.colors.error },
  bannerTitle: { color: theme.colors.text, ...theme.typography.heading },
  bannerBody: { color: theme.colors.textSecondary, ...theme.typography.body },
  skelShelf: { padding: theme.spacing.lg, gap: theme.spacing.md },
  skelCards: { flexDirection: 'row', gap: theme.spacing.md },
}));
