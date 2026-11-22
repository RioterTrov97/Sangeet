import { useCallback, useEffect, useMemo, useState } from 'react';

import { perfStart, perfTime } from '../util/perf';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useLibraryStore } from '../library/store';
import { getHistory } from '../player/history';
import type { Album, Artist, MusicItem, Playlist, Track } from '../youtube/models';
import { ActionButton, GRID_GAP, SAFE_X, SAFE_Y, TrackCard, playAndOpen } from './grid';
import { EmptyStateTV } from './EmptyStateTV';
import { Icon } from './icons';
import { tvNav } from './nav';
import { Card, Focusable, activate } from './ui';
import { useTvWindow } from './scale';
import { tv } from './theme';

const TABS = ['Liked', 'Playlists', 'Artists', 'Albums', 'History'] as const;
type Tab = (typeof TABS)[number];
let lastTab: Tab = 'Liked';
const rememberTab = (t: Tab) => void (lastTab = t);
const CARD = 200;
const TAB_SETTLE_MS = 140;

function TabPill({ label, on, onFocus, preferred }: { label: string; on: boolean; onFocus: () => void; preferred?: boolean }) {
  return (
    <Focusable onFocus={onFocus} onPress={onFocus} preferred={preferred} label={label} scale={1.06} style={[st.pill, on && st.pillCurrent]} focusedStyle={st.pillFocus}>
      {(f) => <Text style={[st.pillText, (f || on) && { color: f ? '#000' : '#fff' }]}>{label}</Text>}
    </Focusable>
  );
}

const goSearch = () => tvNav().root({ name: 'search' });

function LibraryEmpty({ tab }: { tab: Tab }) {
  const action = { label: 'Search for music', onPress: goSearch };
  if (tab === 'Liked') return <EmptyStateTV art="rows" icon="heart" tone="liked" title="Songs you like live here" body="Press the heart on any song to save it here." action={action} />;
  if (tab === 'History') return <EmptyStateTV art="rows" icon="history" title="Nothing played yet" body="Songs you play show up here." action={action} />;
  const what = tab.toLowerCase();
  return <EmptyStateTV icon={tab === 'Playlists' ? 'queue' : tab === 'Artists' ? 'mic' : 'library'} title={`No ${what} yet`} body={`Saved ${what} show up here. This library lives on this TV.`} action={action} />;
}

/** Library on the TV: a tab strip (Liked, Playlists, Artists, Albums, History), each tab shown as a grid. */
export function LibraryTV() {
  const [tab, setTab] = useState<Tab>(lastTab);
  const saved = useLibraryStore((s) => s.saved) as MusicItem[];
  const liked = useLibraryStore((s) => s.liked);
  const { width } = useTvWindow();
  const avail = width - tv.rail - SAFE_X * 2;
  const cols = Math.max(2, Math.floor((avail + GRID_GAP) / (CARD + GRID_GAP)));
  const half = Math.floor((avail - GRID_GAP) / 2);
  const pick = (t: Tab) => {
    rememberTab(t);
    setTab(t);
  };
  // Focus moving across the tab strip must not rebuild the list under every pill it passes: the highlighted pill follows
  // focus at once, the list below follows once focus has rested on a pill for a moment.
  const [shown, setShown] = useState<Tab>(lastTab);
  useEffect(() => {
    if (tab === shown) return;
    const id = setTimeout(() => (perfStart('tab'), setShown(tab)), TAB_SETTLE_MS);
    return () => clearTimeout(id);
  }, [tab, shown]);
  // History is read (and its 60 cards built) only when that tab is actually shown.
  const history = useMemo(() => (shown === 'History' ? perfTime('history read', () => getHistory().slice(0, 60)) : []), [shown]);
  const cards: MusicItem[] = useMemo(() => {
    if (shown === 'Playlists') return saved.filter((x): x is Playlist => x.kind === 'playlist');
    if (shown === 'Artists') return saved.filter((x): x is Artist => x.kind === 'artist');
    if (shown === 'Albums') return saved.filter((x): x is Album => x.kind === 'album');
    return [];
  }, [shown, saved]);
  const tracks: Track[] = useMemo(() => (shown === 'Liked' ? liked : shown === 'History' ? history : []), [shown, liked, history]);
  const trackTab = shown === 'Liked' || shown === 'History';
  const source = shown === 'Liked' ? 'liked' : 'library-history';
  const sourceName = shown === 'Liked' ? 'Liked songs' : 'History';
  const play = useCallback((i: number) => playAndOpen(tracks, i, source, sourceName), [tracks, source, sourceName]);
  const renderTrack = useCallback(({ item, index }: { item: Track; index: number }) => <TrackCard track={item} index={index} width={half} onPress={play} />, [half, play]);
  const empty = trackTab ? tracks.length === 0 : cards.length === 0;
  const tabsBar = (
    <View style={st.tabs}>
      {TABS.map((t) => (
        <TabPill key={t} label={t} on={t === tab} onFocus={() => pick(t)} preferred={t === tab} />
      ))}
    </View>
  );
  const header = (
    <View>
      {trackTab && tracks.length ? (
        <View style={st.actions}>
          <ActionButton label="Play" icon="play" primary width={160} onPress={() => playAndOpen(tracks, 0, source, sourceName)} />
          <ActionButton label="Shuffle" icon="shuffle" width={170} onPress={() => playAndOpen(tracks, 0, source, sourceName, true)} />
          {shown === 'Liked' ? (
            <Focusable onPress={() => tvNav().push({ name: 'liked' })} label="Open liked songs page" style={st.openLink}>
              {(f) => (
                <>
                  <Icon name="heart" size={26} color={f ? '#000' : '#fff'} />
                  <Text style={[st.openText, f && { color: '#000' }]}>{liked.length} songs</Text>
                </>
              )}
            </Focusable>
          ) : null}
        </View>
      ) : null}
      {empty ? <LibraryEmpty tab={shown} /> : null}
    </View>
  );
  const list = trackTab ? (
    <FlatList
      key="tracks"
      data={tracks}
      numColumns={2}
      keyExtractor={(t, i) => `${t.id}-${i}`}
      columnWrapperStyle={{ gap: GRID_GAP }}
      contentContainerStyle={st.list}
      ListHeaderComponent={header}
      initialNumToRender={14}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={60}
      windowSize={5}
      showsVerticalScrollIndicator={false}
      renderItem={renderTrack}
    />
  ) : (
    <FlatList
      key={`cards-${cols}`}
      data={cards}
      numColumns={cols}
      keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
      columnWrapperStyle={{ gap: GRID_GAP }}
      contentContainerStyle={st.list}
      ListHeaderComponent={header}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => <Card item={item} width={CARD} onPress={() => activate(item, cards, 'library')} />}
    />
  );
  return (
    <View style={{ flex: 1 }}>
      {tabsBar}
      {list}
    </View>
  );
}

const st = StyleSheet.create({
  list: { paddingHorizontal: SAFE_X, paddingBottom: 60, gap: GRID_GAP },
  tabs: { flexDirection: 'row', gap: 14, paddingTop: SAFE_Y, paddingHorizontal: SAFE_X, paddingBottom: 20 },
  pill: { height: 54, paddingHorizontal: 30, borderRadius: 27, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  pillCurrent: { backgroundColor: 'rgba(255,255,255,0.24)' },
  pillFocus: { backgroundColor: '#fff' },
  pillText: { color: tv.textDim, fontFamily: tv.font.bold, fontSize: 24 },
  actions: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 20 },
  openLink: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, paddingHorizontal: 24, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.1)' },
  openText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 21 },
});
