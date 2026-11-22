import { useEffect, useMemo, useRef, useState } from 'react';
import { onPerfType } from '../dev/perfDriver';
import { perfOn } from '../util/perfMode';
import { perfEnd, perfStart } from '../util/perf';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { getJson, setJson } from '../util/storage';
import { onNavKey } from '../../modules/tv-keys';
import { buildDropdownRows } from '../search/dropdown';
import { SearchCardTV } from './SearchCardTV';
import { pushBack } from './back';
import { useScreenActive } from './screenActive';
import { useMoods, useSearchAll, useSearchSuggestions } from '../youtube/queries';
import { Artwork } from '../ui/Artwork';
import { itemSubtitle, itemTitle } from '../ui/itemText';
import type { MusicItem, Track } from '../youtube/models';
import { GRID_GAP, SAFE_X, SAFE_Y, TrackGridStatic, playAndOpen } from './grid';
import { Focusable, MoodTile, Row, activate, ring } from './ui';
import { useTvWindow } from './scale';
import { tv } from './theme';
import { EmptyStateTV } from './EmptyStateTV';

const MOOD_GAP = 18;
const MOOD_COLS = 5;
const RECENT_KEY = 'tv.search.recent';

function Pill({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Focusable onPress={onPress} label={label} disabled={disabled} style={st.pill} focusedStyle={st.pillOn} scale={1.05}>
      {(f) => <Text style={[st.pillText, f && { color: '#000' }]}>{label}</Text>}
    </Focusable>
  );
}

/** The top result as a large card beside a two-column grid of the top songs, then rows for everything else. */
function Results({ query, shelves, claimFocus }: { query: string; shelves: { title: string; items: MusicItem[] }[]; claimFocus?: boolean }) {
  const { width } = useTvWindow();
  const top = shelves.find((s) => s.title === 'Top result')?.items[0];
  const songShelf = shelves.find((s) => /^songs$/i.test(s.title)) ?? shelves.find((s) => s.title === 'From this artist' && s.items.some((i) => i.kind === 'track'));
  const songs = (songShelf?.items ?? []).filter((i): i is Track => i.kind === 'track').slice(0, 6);
  const rest = shelves.filter((s) => s.title !== 'Top result' && s !== songShelf);
  useEffect(() => perfEnd('search', 'results on screen'), []);
  const topW = 440;
  const gridW = width - tv.rail - SAFE_X * 2 - topW - 28;
  return (
    <>
      <View style={st.topRow}>
        {top ? <TopCard item={top} width={topW} preferred={claimFocus} /> : null}
        {songs.length ? (
          <View style={{ flex: 1 }}>
            <TrackGridStatic tracks={songs} width={gridW} onPlay={(i) => playAndOpen(songs, i, 'search', query)} />
          </View>
        ) : null}
      </View>
      {rest.map((shelf, i) => (
        <Row key={`${shelf.title}-${i}`} id={`search-${query}-${shelf.title}`} title={shelf.title} items={shelf.items} source="search" />
      ))}
    </>
  );
}

function TopCard({ item, width, preferred }: { item: MusicItem; width: number; preferred?: boolean }) {
  const round = item.kind === 'artist';
  const sub = itemSubtitle(item);
  return (
    <Focusable onPress={() => activate(item, [item], 'search')} preferred={preferred} label={itemTitle(item)} style={[st.top, { width }]} focusedStyle={st.topOn} scale={1.04}>
      <Artwork art={item.artwork} size={140} round={round} style={{ borderRadius: round ? 70 : 10 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={st.topLabel}>TOP RESULT</Text>
        <Text style={st.topTitle} numberOfLines={3}>
          {itemTitle(item)}
        </Text>
        {sub ? (
          <Text style={st.topSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Focusable>
  );
}

/** Search: the field opens the system TV keyboard (with voice input). Results as rows; mood/genre tiles when empty. */
export function SearchTV() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => getJson<string[]>(RECENT_KEY) ?? []);
  const moods = useMoods().data;
  // Typing on the TV keyboard fires a change per character; ask for suggestions once typing pauses.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setTyped(input), 250);
    return () => clearTimeout(id);
  }, [input]);
  const suggest = useSearchSuggestions(typed);
  const inputRef = useRef<{ focus: () => void }>(null);
  // The dropdown stays open while the field or one of its rows has focus (a short delay bridges field -> row hand-over).
  const fieldOn = useRef(false);
  const rowsOn = useRef(0);
  const [open, setOpen] = useState(false);
  const [cardShown, setCardShown] = useState(false);
  const dismissed = useRef(false); // Back closed the dropdown; it stays closed until focus leaves the field or the text changes
  const sync = () =>
    setTimeout(() => {
      const on = fieldOn.current || rowsOn.current > 0;
      if (!on) dismissed.current = false;
      setOpen(on && !dismissed.current);
    }, 60);
  // The first mood tile keeps first focus until the user presses a D-pad key (content arriving later never pulls it).
  const [early, setEarly] = useState(true);
  useEffect(() => {
    if (!early) return;
    const sub = onNavKey(() => setEarly(false));
    return () => sub.remove();
  }, [early]);
  const results = useSearchAll(query);

  // A recent pill or dropdown row was chosen: show the text only, keep the field unfocused and hand focus to the results.
  const [picked, setPicked] = useState(false);
  const submit = (text: string, pick = false) => {
    const q = text.trim();
    if (!q) return;
    perfStart('search');
    setPicked(pick);
    setInput(q);
    setQuery(q);
    fieldOn.current = false;
    rowsOn.current = 0;
    setOpen(false);
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, 10);
    setRecent(next);
    setJson(RECENT_KEY, next);
  };
  // Perf mode only: `sangeet://dev?cmd=type&a=...` types a query for repeatable runs.
  useEffect(() => (perfOn() ? onPerfType(submit) : undefined));
  const rowsList = useMemo(() => buildDropdownRows(input, recent, suggest.data), [input, recent, suggest.data]);
  const dropdown = open && rowsList.length > 0;
  const active = useScreenActive();
  useEffect(() => {
    if (!dropdown || !active) return;
    return pushBack(() => {
      dismissed.current = true;
      setOpen(false);
      inputRef.current?.focus();
      return true;
    });
  }, [dropdown, active]);
  const clearRecent = () => {
    setRecent([]);
    setJson(RECENT_KEY, []);
    rowsOn.current = 0;
    setOpen(false);
  };
  const shelves = useMemo(() => results.data ?? [], [results.data]);
  const { width } = useTvWindow();
  const tileW = Math.floor((width - tv.rail - SAFE_X * 2 - (MOOD_COLS - 1) * MOOD_GAP) / MOOD_COLS);

  // One list for everything: the field and pills are its header, the results its footer, and the browse grid its rows of five
  // tiles (virtualised: only the rows near the screen are mounted, and each row has a fixed height).
  const browse = !query;
  const rows = useMemo(() => {
    const list = browse ? (moods ?? []) : [];
    return Array.from({ length: Math.ceil(list.length / MOOD_COLS) }, (_, i) => list.slice(i * MOOD_COLS, (i + 1) * MOOD_COLS));
  }, [browse, moods]);
  const tileH = Math.round(tileW / 1.6);
  const rowH = tileH + MOOD_GAP + 12;
  const header = (
    <View>
      <View style={st.slot}>
        <SearchCardTV
          open={dropdown}
          ring={focused}
          rows={rowsList}
          canClear={input.trim() === '' && recent.length > 0}
          onPick={(t) => submit(t, true)}
          onClear={clearRecent}
          onRowFocus={() => (rowsOn.current++, sync())}
          onRowBlur={() => (rowsOn.current--, sync())}
          onShown={setCardShown}
        />
        <View style={[st.inputWrap, focused && !cardShown && st.inputOn, cardShown && st.inputShown]}>
          <TextInput
            ref={inputRef as never}
            style={st.input}
            value={input}
            onChangeText={(t) => {
              dismissed.current = false;
              setInput(t);
              sync();
            }}
            onSubmitEditing={() => submit(input)}
            onFocus={() => {
              setFocused(true);
              fieldOn.current = true;
              sync();
            }}
            onBlur={() => {
              setFocused(false);
              fieldOn.current = false;
              sync();
            }}
            placeholder="Search songs, albums, artists"
            placeholderTextColor="#888"
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search"
          />
        </View>
      </View>
      {(!query || (picked && results.isLoading)) && recent.length ? (
        <View style={[st.pills, st.oneRow]}>
          {/* Not mounted while the dropdown covers them, so D-pad Down from the field reaches the dropdown rows. */}
          {dropdown ? null : recent.slice(0, 5).map((q) => <Pill key={q} label={q} onPress={() => submit(q, true)} />)}
        </View>
      ) : null}
      {/* Same gap above the first tile row as between tile rows (MOOD_GAP below + the row's own 12 top padding). */}
      {browse ? <View style={{ height: MOOD_GAP }} /> : null}
    </View>
  );
  const footer = query ? (
    results.isLoading ? (
      <View style={st.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    ) : shelves.length ? (
      <Results query={query} shelves={shelves} claimFocus={picked} />
    ) : (
      results.isError ? <EmptyStateTV icon="warning" tone="error" title="Search failed" body="Check the connection and try again." /> : <EmptyStateTV icon="search" title={`No results for "${query}"`} body="Check the spelling or try fewer words." />
    )
  ) : null;

  return (
    <FlatList
      data={rows}
      extraData={dropdown}
      keyExtractor={(r) => r[0]?.title ?? 'empty'}
      renderItem={({ item }) => (
        <View style={[st.moodRow, { height: rowH }]}>
          {item.map((m, i) => (
            <MoodTile key={m.title} mood={m} width={tileW} height={tileH} disabled={dropdown} preferred={early && browse && i === 0 && item === rows[0]} />
          ))}
        </View>
      )}
      getItemLayout={(_, i) => ({ length: rowH, offset: rowH * i, index: i })}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={{ zIndex: 10, elevation: 10 }}
      ListFooterComponent={footer ?? undefined}
      contentContainerStyle={st.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      initialNumToRender={3}
      maxToRenderPerBatch={2}
      updateCellsBatchingPeriod={80}
      windowSize={5}
      removeClippedSubviews={false}
    />
  );
}

const st = StyleSheet.create({
  content: { paddingTop: SAFE_Y, paddingBottom: 80 },
  inputWrap: { marginHorizontal: tv.gutter, height: 76, borderRadius: 38, backgroundColor: tv.surfaceHigh, borderWidth: 3, borderColor: 'transparent', justifyContent: 'center', paddingHorizontal: 32 },
  inputOn: { borderColor: '#fff' },
  inputShown: { backgroundColor: 'transparent', borderColor: 'transparent' },
  slot: { height: 76, zIndex: 20, elevation: 20 },
  input: { color: '#fff', fontFamily: tv.font.medium, fontSize: 28, padding: 0 },
  topRow: { flexDirection: 'row', gap: 28, paddingHorizontal: SAFE_X, marginTop: 26, marginBottom: 8, alignItems: 'flex-start' },
  top: { height: 3 * 76 + 2 * GRID_GAP, borderRadius: 18, padding: 22, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 3, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 20 },
  topOn: { ...ring, backgroundColor: 'rgba(255,255,255,0.16)' },
  topLabel: { color: tv.textDim, fontFamily: tv.font.bold, fontSize: 18, letterSpacing: 2 },
  topTitle: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 28, lineHeight: 34 },
  topSub: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 20 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginHorizontal: tv.gutter, marginTop: 22 },
  /** Recent searches: one row only (the mood tiles follow directly). */
  oneRow: { flexWrap: 'nowrap', overflow: 'hidden', height: 56, paddingHorizontal: 16, paddingVertical: 4, marginHorizontal: tv.gutter - 16, marginTop: 18, marginBottom: -4 },
  pill: { paddingHorizontal: 24, height: 48, borderRadius: 24, backgroundColor: tv.surfaceHigh, justifyContent: 'center' },
  pillOn: { backgroundColor: '#fff' },
  pillText: { color: '#fff', fontFamily: tv.font.medium, fontSize: 20 },
  center: { height: 300, alignItems: 'center', justifyContent: 'center' },
  moodRow: { flexDirection: 'row', gap: MOOD_GAP, paddingHorizontal: tv.gutter, paddingTop: 12 },
});
