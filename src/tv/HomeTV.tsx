import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { filterFeed, itemKey, mergeReleases, mixQuickPicks, ytQuickPicks } from '../home/layout';
import { boostLiked, freshOnly } from '../home/personalize';
import { useIsOffline } from '../downloads/net';
import { usePersonal } from '../ui/home/usePersonal';
import type { Album, MusicItem, Track } from '../youtube/models';
import { useBecause, useCharts, useExplore, useHome, useHomeMore, useMoods } from '../youtube/queries';
import type { Mood } from '../youtube/api';
import { getHistory } from '../player/history';
import { playTracks, togglePlay, useNowPlaying, usePlayerStore } from '../player';
import { Artwork } from '../ui/Artwork';
import { Equalizer } from '../ui/Equalizer';
import { HomeBackdrop } from './HomeBackdrop';
import { usePalette } from '../ui/palette/store';
import { pickArtwork } from '../youtube/mappers/common';
import { itemTitle } from '../ui/itemText';
import { ActionButton, SAFE_X, SAFE_Y } from './grid';
import { onNavKey } from '../../modules/tv-keys';
import { tvNav } from './nav';
import { Button, CARD_GAP, CARD_LABELS, Focusable, MoodTile, Row, activate, rememberFocus, useRestoreOnce, ring, setBackdrop } from './ui';
import { useTvWindow } from './scale';
import { perfEnd } from '../util/perf';
import { useHomeStage, type HomeFocusKey, type HomeSection } from './lazyHome';
import { tv } from './theme';

const SCREEN = 'home';

/** Fixed heights of the rows that are not mounted yet, so everything below keeps its place and the focus/scroll positions do not jump when they appear. */
const HOLD = { top: 283, personal: 356, new: 356, artists: 356, moods: 235 };
const Hold = ({ h }: { h: number }) => <View style={{ height: h }} />;

function greeting(hour = new Date().getHours()): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The spotlight's progress bar: the only part that follows the playback position, in whole seconds (every update redraws the TV window), so the rest never re-renders for it. */
function SpotBar() {
  const position = usePlayerStore((s) => Math.floor(s.position));
  const duration = usePlayerStore((s) => Math.floor(s.duration || s.queue[s.index]?.durationSec || 0));
  const pal = usePalette();
  const frac = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <View style={st.spotBar}>
      <View style={{ width: `${frac * 100}%`, height: '100%', borderRadius: 3, backgroundColor: pal.accent }} />
    </View>
  );
}

/**
 * The Home spotlight follows live state: while a song is loaded and not stopped it is "Now playing" with progress and
 * Pause/Play + Open player; "Continue listening / Resume" only when nothing is loaded or playback is stopped.
 */
function Spotlight({ trending, onSection }: { trending?: Track; onSection: () => void }) {
  const np = useNowPlaying();
  const last = useMemo(() => getHistory()[0], []);
  const live = !!np.track && np.status !== 'idle';
  const track = np.track ?? last ?? trending;
  const resuming = !live && !!(np.track ?? last);
  const restoreFocus = useRestoreOnce(SCREEN);
  // The spotlight's main button keeps first focus until the user presses a D-pad key, so content arriving later (the
  // restored queue turning "Resume" into "Pause", rows loading below) never pulls focus and the scroll down to Quick picks.
  const [early, setEarly] = useState(true);
  useEffect(() => {
    if (!early) return;
    const sub = onNavKey(() => setEarly(false));
    return () => sub.remove();
  }, [early]);
  useEffect(() => {
    if (track) setBackdrop(pickArtwork(track.artwork, 320));
  }, [track]);
  if (!track) return <View style={{ height: 40 }} />;
  const open = () => tvNav().push({ name: 'now' });
  const go = () => {
    if (np.track) {
      if (!np.isPlaying) void togglePlay();
    } else void playTracks([track], 0, { source: resuming ? 'home-resume' : 'home-trending' });
    open();
  };
  return (
    <View style={st.spot}>
      <Artwork art={track.artwork} size={236} style={{ borderRadius: 16 }} />
      <View style={st.spotText}>
        <Text style={st.greeting}>{greeting()}</Text>
        <Text style={st.spotLabel}>{live ? (np.isPlaying ? 'Now playing' : 'Paused') : resuming ? 'Continue listening' : 'Trending now'}</Text>
        <Text style={st.spotTitle} numberOfLines={2}>
          {track.title}
        </Text>
        <Text style={st.spotArtist} numberOfLines={1}>
          {track.artists.map((a) => a.name).join(', ')}
        </Text>
        {live ? <SpotBar /> : null}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          {/* One primary button element in both states (same key): switching Resume -> Pause keeps the native view and its focus. */}
          <ActionButton
            key="primary"
            label={live ? (np.isPlaying ? 'Pause' : 'Play') : resuming ? 'Resume' : 'Play'}
            icon={live && np.isPlaying ? 'pause' : 'play'}
            primary
            preferred={early && !restoreFocus}
            onPress={live ? () => void togglePlay() : go}
            onFocus={onSection}
            width={190}
          />
          {live ? <ActionButton key="open" label="Open player" icon="now" onPress={open} onFocus={onSection} width={230} /> : null}
        </View>
      </View>
      <NowPill />
    </View>
  );
}

/** Small pill (top right) that opens Now Playing while something is queued. */
function NowPill({ onSection }: { onSection?: () => void }) {
  const { track, isPlaying } = useNowPlaying();
  const pal = usePalette();
  if (!track) return null;
  return (
    <View style={st.pillWrap} pointerEvents="box-none">
      <Focusable onPress={() => tvNav().push({ name: 'now' })} onFocus={onSection} label="Now playing" scale={1.06} style={st.pill} focusedStyle={{ backgroundColor: '#fff' }}>
        {(f) => (
          <>
            <Artwork art={track.artwork} size={44} style={{ borderRadius: 8 }} />
            <Equalizer playing={isPlaying} color={f ? '#000' : pal.accent} />
            <Text style={[st.pillText, f && { color: '#000' }]}>Now playing</Text>
          </>
        )}
      </Focusable>
    </View>
  );
}

/** Quick picks: a 2-row grid of compact wide tiles (art plus title), four per row. */
function QuickGrid({ items, onSection }: { items: MusicItem[]; onSection: () => void }) {
  const { width } = useTvWindow();
  const restore = useRestoreOnce(SCREEN);
  const gap = 16;
  const w = Math.floor((width - tv.rail - SAFE_X * 2 - gap * 3) / 4);
  const shown = items.slice(0, 8);
  const any = shown.length > 0;
  useEffect(() => void (any && perfEnd('launch', 'first quick pick tile', true)), [any]);
  if (!any) return null;
  return (
    <View style={st.section}>
      <Text style={st.sectionTitle}>Quick picks</Text>
      <View style={[st.quick, { gap }]}>
        {shown.map((it, i) => (
          <Focusable
            key={`${it.kind}-${it.id}-${i}`}
            label={itemTitle(it)}
            preferred={restore === `quick:${i}`}
            onFocus={() => {
              rememberFocus(SCREEN, `quick:${i}`);
              onSection();
              setBackdrop(pickArtwork(it.artwork, 320));
            }}
            onPress={() => activate(it, shown, 'home-quick')}
            layer
            style={[st.tile, { width: w }]}
            focusedStyle={st.tileOn}
            scale={1.04}>
            <Artwork art={it.artwork} size={72} style={{ borderRadius: 8 }} />
            <Text style={st.tileTitle} numberOfLines={2}>
              {itemTitle(it)}
            </Text>
          </Focusable>
        ))}
      </View>
    </View>
  );
}

/** Top songs: numbered wide cards, five visible. */
function NumberedRow({ items, onSection }: { items: Track[]; onSection: () => void }) {
  const { width } = useTvWindow();
  const restore = useRestoreOnce(SCREEN);
  const w = Math.floor((width - tv.rail - SAFE_X * 2 - CARD_GAP * 4) / 5);
  const h = Math.round((w * 9) / 16);
  const shown = items.slice(0, 12);
  if (!shown.length) return null;
  return (
    <View style={st.section}>
      <Text style={st.sectionTitle}>Top songs</Text>
      <FlatList
        horizontal
        data={shown}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.numList}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        initialNumToRender={12}
        renderItem={({ item, index }) => (
          <Focusable
            label={`${index + 1}. ${item.title}`}
            preferred={restore === `top:${index}`}
            onFocus={() => {
              rememberFocus(SCREEN, `top:${index}`);
              onSection();
              setBackdrop(pickArtwork(item.artwork, 320));
            }}
            onPress={() => activate(item, shown, 'home-top')}
            layer
            style={{ width: w }}
            scale={1.06}>
            {(f) => (
              <>
                <View style={[st.numArt, { width: w, height: h }, f && ring]}>
                  <Artwork art={item.artwork} size={w} style={{ width: w, height: h, borderRadius: 9 }} />
                  <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.7)']} style={st.numScrim} />
                  <Text style={st.rank}>{index + 1}</Text>
                </View>
                <View style={st.cardLabel}>
                  {CARD_LABELS === 'always' || f ? (
                    <Text style={[st.cardTitle, f && { color: '#fff' }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                  ) : null}
                  {f ? (
                    <Text style={st.cardSub} numberOfLines={1}>
                      {item.artists.map((a) => a.name).join(', ')}
                    </Text>
                  ) : null}
                </View>
              </>
            )}
          </Focusable>
        )}
      />
    </View>
  );
}

function MoodsRow({ moods, onSection }: { moods: Mood[]; onSection: () => void }) {
  const restore = useRestoreOnce(SCREEN);
  if (!moods.length) return null;
  return (
    <View style={st.section}>
      <Text style={st.sectionTitle}>Moods & genres</Text>
      <FlatList
        horizontal
        data={moods.slice(0, 12)}
        keyExtractor={(m) => m.title}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.numList}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        renderItem={({ item, index }) => <MoodTile mood={item} width={232} preferred={restore === `mood:${index}`} onFocus={() => (rememberFocus(SCREEN, `mood:${index}`), onSection())} />}
      />
    </View>
  );
}

function BecauseRow({ seed, recent, onSection }: { seed: Track; recent: Track[]; onSection: () => void }) {
  const q = useBecause(seed.id);
  const items = useMemo(() => freshOnly(q.data ?? [], seed.id, recent, 12), [q.data, seed.id, recent]);
  return <Row id={`because-${seed.id}`} title={`Because you listened to ${seed.title}`} items={items} source="home-because" screen={SCREEN} onRowFocus={onSection} />;
}

/** At most six rows, each with one consistent card style: quick picks, top songs, a personal or feed row, new releases, artists, moods. */
export function HomeTV() {
  const { data, isLoading, isError, refetch } = useHome();
  const offline = useIsOffline();
  const personal = usePersonal();
  const explore = useExplore();
  // Rows below the first screen load one at a time: after the app has been idle for a moment, or as focus nears them.
  const stage = useHomeStage(!!data || !!explore.data);
  const has = (k: HomeSection) => stage.has(k);
  const moodTiles = useMoods(has('moods')).data;
  const charts = useCharts(has('artists')).data;
  const moods = useMemo(() => (moodTiles ?? []).filter((m) => m.params), [moodTiles]);
  const more = useHomeMore(!!data && !offline && has('personal'));
  const ex = explore.data;

  const content = useMemo(() => {
    if (offline) return undefined;
    const liked = personal.liked;
    const topSongs = boostLiked(ex?.topSongs ?? [], liked, 3).slice(0, 12);
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
    const seen = new Set<string>([...quick.map(itemKey), ...top3]);
    const releases: Album[] = mergeReleases(
      boostLiked(ex?.newAlbums?.length || ex?.newSingles?.length ? (ex?.newAlbums ?? []) : (ex?.newReleases ?? []).filter((i): i is Album => i.kind === 'album'), liked, 3),
      boostLiked(ex?.newSingles ?? [], liked, 3),
    );
    for (const r of releases) seen.add(itemKey(r));
    const feed = data ? filterFeed([...data, ...more.shelves.filter((m) => !data.some((d) => d.title === m.title))], new Set(seen), ['Quick picks']) : [];
    return { quick, topSongs, releases, feed };
  }, [data, offline, personal, ex, more.shelves]);

  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const ys = useRef<Record<string, number>>({});
  const lay = useCallback((k: string) => (e: LayoutChangeEvent) => void (ys.current[k] = e.nativeEvent.layout.y), []);
  const focusStage = stage.focus;
  const snap = useCallback(
    (k: HomeFocusKey) => {
      scroll.current?.scrollTo({ y: k === 'spot' ? 0 : Math.max(0, (ys.current[k] ?? 0) - 12), animated: true });
      focusStage(k);
    },
    [focusStage],
  );
  const bg = <HomeBackdrop />;
  if (offline) {
    return (
      <View style={{ flex: 1 }}>
        {bg}
        <ScrollView contentContainerStyle={st.content}>
          <Text style={st.offline}>You&apos;re offline</Text>
          <Text style={st.offlineNote}>Sangeet on TV streams music, so it needs the internet. Check the TV&apos;s connection.</Text>
        </ScrollView>
      </View>
    );
  }
  const c = content!;
  if (!data && !ex && (isLoading || explore.isLoading)) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }
  if (!data && isError && explore.isError) {
    return (
      <View style={st.center}>
        <Text style={st.offline}>Could not load Home</Text>
        <Button label="Retry" primary preferred onPress={() => void refetch()} />
      </View>
    );
  }
  const artists: MusicItem[] = personal.followed.length || personal.personalised ? personal.artistItems.slice(0, 12) : (charts?.artists ?? []).slice(0, 12);
  const artistTitle = personal.followed.length || personal.personalised ? 'Your artists' : 'Popular artists';
  const feedRow = c.feed[0];
  return (
    <View style={{ flex: 1 }}>
      {bg}
      <ScrollView ref={scroll} contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
        <Spotlight trending={c.topSongs[0]} onSection={() => snap('spot')} />
        <View onLayout={lay('quick')}>
          <QuickGrid items={c.quick} onSection={() => snap('quick')} />
        </View>
        <View onLayout={lay('top')}>{has('top') ? <NumberedRow items={c.topSongs} onSection={() => snap('top')} /> : <Hold h={HOLD.top} />}</View>
        <View onLayout={lay('personal')}>
          {!has('personal') ? (
            <Hold h={HOLD.personal} />
          ) : personal.personalised && personal.seeds[0] ? (
            <BecauseRow seed={personal.seeds[0]} recent={personal.recent} onSection={() => snap('personal')} />
          ) : feedRow ? (
            <Row id={`feed-${feedRow.title}`} title={feedRow.title} items={feedRow.items} source="home" screen={SCREEN} onRowFocus={() => snap('personal')} />
          ) : null}
        </View>
        <View onLayout={lay('new')}>
          {has('new') ? <Row id="new" title="New releases" items={c.releases} source="home-new" screen={SCREEN} onRowFocus={() => snap('new')} /> : <Hold h={HOLD.new} />}
        </View>
        <View onLayout={lay('artists')}>
          {has('artists') ? <Row id="artists" title={artistTitle} items={artists} screen={SCREEN} onRowFocus={() => snap('artists')} /> : <Hold h={HOLD.artists} />}
        </View>
        <View onLayout={lay('moods')}>{has('moods') ? <MoodsRow moods={moods} onSection={() => snap('moods')} /> : <Hold h={HOLD.moods} />}</View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  content: { paddingTop: SAFE_Y, paddingBottom: 80 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  offline: { color: tv.text, fontFamily: tv.font.extraBold, fontSize: 40, marginLeft: tv.gutter, marginBottom: 6 },
  offlineNote: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24, marginLeft: tv.gutter },
  backdropImg: { opacity: 0.6 },
  spot: { flexDirection: 'row', alignItems: 'center', gap: 36, paddingHorizontal: SAFE_X, height: 300 },
  spotText: { flex: 1, paddingRight: 260 },
  greeting: { color: 'rgba(255,255,255,0.7)', fontFamily: tv.font.medium, fontSize: 22 },
  spotLabel: { color: '#fff', fontFamily: tv.font.bold, fontSize: 24, marginTop: 2, opacity: 0.9 },
  spotTitle: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 40, lineHeight: 46, marginTop: 6 },
  spotArtist: { color: 'rgba(255,255,255,0.8)', fontFamily: tv.font.medium, fontSize: 24, marginTop: 2 },
  spotBar: { width: 420, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, overflow: 'hidden' },
  pillWrap: { position: 'absolute', top: -6, right: SAFE_X },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 60, paddingLeft: 8, paddingRight: 24, borderRadius: 30, backgroundColor: 'rgba(20,20,24,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  pillText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 22 },
  section: { marginTop: 14, marginBottom: 6 },
  sectionTitle: { color: tv.text, fontFamily: tv.font.bold, fontSize: 28, marginLeft: SAFE_X, marginBottom: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SAFE_X, rowGap: 16 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 84, paddingHorizontal: 6, paddingRight: 14, borderRadius: 14, borderWidth: 3, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.1)' },
  tileOn: { ...ring, backgroundColor: 'rgba(255,255,255,0.2)' },
  tileTitle: { flex: 1, color: '#fff', fontFamily: tv.font.bold, fontSize: 24, lineHeight: 29 },
  numList: { paddingHorizontal: SAFE_X, paddingVertical: 12 },
  numArt: { borderRadius: 12, borderWidth: 3, borderColor: 'transparent', overflow: 'hidden', backgroundColor: tv.surface },
  numScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  rank: { position: 'absolute', left: 12, bottom: 2, color: '#fff', fontFamily: tv.font.extraBold, fontSize: 52, lineHeight: 60 },
  cardLabel: { height: 54, marginTop: 10 },
  cardTitle: { color: '#d8d8de', fontFamily: tv.font.bold, fontSize: 22 },
  cardSub: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 18, marginTop: 2 },
});
