import { useFloatingInset } from './floating';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Alert, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { playTracks, seekTo } from '../player';
import { playSong } from './playSong';
import { playerState } from '../player/store';
import { getJson, setJson } from '../util/storage';
import type { MusicItem, SearchType } from '../youtube/models';
import { useIsOffline } from '../downloads/net';
import { Image } from 'expo-image';
import type { Mood } from '../youtube/api';
import { tileColor } from './palette/tiles';
import Svg, { Path } from 'react-native-svg';
import { moodIcon, tileShapes } from './moodTileArt';
import { useMoods, useSearchAll, useSearchSuggestions, useSearchType } from '../youtube/queries';
import { loadMoodArt, prefetchMood, useMoodArt } from '../search/moodArt';
import { Chip } from './Controls';
import { MusicItemRow } from './ItemRow';
import { Screen, SectionTitle, TabHeader, useTabTop } from './Layout';
import { AvatarMenu } from './AvatarMenu';
import { addRecent, removeRecent } from '../search/recent';
import { buildDropdownRows } from '../search/dropdown';
import { SearchCard } from './SearchCard';
import { useVoiceSearch } from './voice';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { AnimatedFlashList, useScrollY } from './scroll';
import { Artwork } from './Artwork';
import { itemSheet } from './actions';
import { MoreButton } from './MoreButton';
import { itemSubtitle, itemTitle } from './itemText';
import { ErrorState, Skeleton, EmptyState } from './States';
import { openItem } from './nav';
import { logWarn } from '../util/log';

async function seekFromEnd(sec: number): Promise<void> {
  const d = playerState().duration;
  if (d > 0) await seekTo(Math.max(0, d - sec));
}

const CHIPS: { key: 'all' | SearchType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'song', label: 'Songs' },
  { key: 'video', label: 'Videos' },
  { key: 'album', label: 'Albums' },
  { key: 'artist', label: 'Artists' },
  { key: 'playlist', label: 'Playlists' },
];
const RECENT_KEY = 'search.recent';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchScreen() {
  const floatInset = useFloatingInset();
  const { scrollY, onScroll } = useScrollY();
  const top = useTabTop(true);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [chip, setChip] = useState<'all' | SearchType>('all');
  const [recent, setRecent] = useState<string[]>(() => getJson<string[]>(RECENT_KEY) ?? []);
  const { theme } = useUnistyles();
  const moods = useMoods();
  // Tile pictures: missing ones are fetched one mood page at a time in the background, never all at once.
  useEffect(() => (moods.data?.length ? loadMoodArt(moods.data) : undefined), [moods.data]);
  const suggestions = useSearchSuggestions(useDebounced(input, 200));

  const submit = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setInput(q);
    setQuery(q);
    remember(q);
    setFocused(false);
    Keyboard.dismiss();
  };
  // The dropdown closes with the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setFocused(false));
    return () => sub.remove();
  }, []);
  const remember = (q: string) => {
    const next = addRecent(recent, q);
    setRecent(next);
    setJson(RECENT_KEY, next);
  };
  const forget = (q: string) => {
    const next = removeRecent(recent, q);
    setRecent(next);
    setJson(RECENT_KEY, next);
  };
  const voice = useVoiceSearch({ onPartial: setInput, onFinal: (t) => submit(t) });

  // Dev driver: sangeet://search?q=<q>&type=<song|album|...>&open=<index> (open = navigate to that result)
  const params = useLocalSearchParams<{ q?: string; type?: string; open?: string; play?: string; seek?: string }>();
  useEffect(() => {
    if (!params.q) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dev deep-link driver
    submit(params.q);
    if (params.type) setChip(params.type as SearchType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.type]);

  const all = useSearchAll(chip === 'all' ? query : '');
  const typed = useSearchType(chip === 'all' ? '' : query, chip === 'all' ? 'song' : chip);

  const handled = useRef<string>('');
  const openIdx = params.open !== undefined ? Number(params.open) : undefined;
  const openTarget = useMemo(() => (openIdx === undefined ? undefined : typed.items[openIdx]), [openIdx, typed.items]);
  useEffect(() => {
    if (!openTarget || handled.current === openTarget.id) return;
    handled.current = openTarget.id;
    if (openTarget.kind === 'album' && params.play) router.push({ pathname: '/album/[id]', params: { id: openTarget.id, play: params.play } });
    else openItem(openTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);
  const playTarget = params.play !== undefined && params.open === undefined ? typed.items[Number(params.play)] : undefined;
  useEffect(() => {
    if (playTarget?.kind === 'track') void playTracks([playTarget], 0, { source: 'search' });
  }, [playTarget]);
  useEffect(() => {
    if (params.seek) void seekFromEnd(Number(params.seek));
  }, [params.seek]);

  const rows = useMemo(() => buildDropdownRows(input, recent, suggestions.data), [input, recent, suggestions.data]);
  const dropdownOpen = focused && rows.length > 0;
  const closeDropdown = () => {
    setFocused(false);
    Keyboard.dismiss();
  };
  const clearRecent = () => {
    setRecent([]);
    setJson(RECENT_KEY, []);
  };
  const confirmClear = () =>
    Alert.alert('Clear all recent searches?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: clearRecent },
    ]);
  // The card starts exactly at the field's top: measure the field when the card is about to open.
  const fieldRef = useRef<{ measureInWindow: (cb: (x: number, y: number) => void) => void }>(null);
  const [cardTop, setCardTop] = useState<number | null>(null);
  const [cardShown, setCardShown] = useState(false);
  useEffect(() => {
    if (dropdownOpen) fieldRef.current?.measureInWindow((_x: number, y: number) => setCardTop(y));
  }, [dropdownOpen]);
  const clear = () => {
    setInput('');
    setQuery('');
  };

  const offline = useIsOffline();
  if (offline) {
    return (
      <Screen top="under">
        <View style={{ paddingTop: top }}>
          <EmptyState icon="wifi.slash" tone="offline" title="Search needs a connection" body="You're offline. Your downloaded music is in Library, under Downloads." action={{ label: 'Open downloads', kind: 'secondary', onPress: () => router.push('/downloads' as never) }} />
        </View>
        <TabHeader title="Search" scrollY={scrollY} left={<AvatarMenu />} right={<MicButton voice={voice} />} />
      </Screen>
    );
  }

  const chipRow = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {CHIPS.map((c) => (
        <Chip key={c.key} label={c.label} selected={chip === c.key} onPress={() => setChip(c.key)} />
      ))}
    </ScrollView>
  );

  return (
    <Screen top="under">
      {query ? (
        <>
          {chip === 'all' ? (
            all.isLoading ? (
              <View style={{ paddingTop: top }}><ResultSkeleton /></View>
            ) : all.isError ? (
              <View style={{ paddingTop: top }}><ErrorState message="Search failed" onRetry={() => void all.refetch()} /></View>
            ) : (
              <AnimatedFlashList
                onScroll={onScroll}
                scrollEventThrottle={16}
                ListHeaderComponent={chipRow}
                data={(all.data ?? []).flatMap((s) => [{ header: s.title } as const, ...s.items.slice(0, s.title === 'Top result' ? 1 : 6).map((it) => ({ it, top: s.title === 'Top result' }))])}
                keyExtractor={(x: any, i: number) => ('header' in x ? `h-${x.header}` : `${x.it.kind}-${x.it.id}-${i}`)}
                getItemType={(x: any) => ('header' in x ? 'h' : x.top ? 'top' : 'row')}
                contentContainerStyle={[styles.list, { paddingTop: top, paddingBottom: floatInset }]}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }: { item: any }) => ('header' in item ? (item.header === 'Top result' ? <SectionTitle title="Top result" first /> : <SectionTitle title={item.header} />) : item.top ? <TopResult item={item.it} onOpen={() => remember(query)} /> : <MusicItemRow item={item.it} onOpen={() => remember(query)} />)}
                ListEmptyComponent={<EmptyState icon="magnifyingglass" title={`No results for "${query}"`} body="Check the spelling or try fewer words." />}
              />
            )
          ) : typed.isLoading ? (
            <View style={{ paddingTop: top }}><ResultSkeleton /></View>
          ) : typed.isError ? (
            <View style={{ paddingTop: top }}><ErrorState message="Search failed" onRetry={() => void typed.refetch()} /></View>
          ) : (
            <AnimatedFlashList
              onScroll={onScroll}
              scrollEventThrottle={16}
              ListHeaderComponent={chipRow}
              data={typed.items}
              keyExtractor={(x: MusicItem, i: number) => `${x.kind}-${x.id}-${i}`}
              getItemType={(x: MusicItem) => x.kind}
              contentContainerStyle={[styles.list, { paddingTop: top, paddingBottom: floatInset }]}
              keyboardShouldPersistTaps="handled"
              onEndReachedThreshold={0.5}
              onEndReached={() => typed.hasNextPage && !typed.isFetchingNextPage && void typed.fetchNextPage().catch((e) => logWarn('search', e))}
              renderItem={({ item }: { item: MusicItem }) => <MusicItemRow item={item} onOpen={() => remember(query)} />}
              ListEmptyComponent={<EmptyState icon="magnifyingglass" title={`No results for "${query}"`} body="Check the spelling or try fewer words." />}
              ListFooterComponent={typed.isFetchingNextPage ? <Skeleton height={48} style={styles.footer} /> : undefined}
            />
          )}
        </>
      ) : (
        <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.list, { paddingTop: top, paddingBottom: floatInset }]} showsVerticalScrollIndicator={false}>
          {recent.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
              {recent.slice(0, 6).map((r) => (
                <Chip key={r} label={r} onPress={() => submit(r)} />
              ))}
            </ScrollView>
          ) : null}
          <View style={[styles.moods, styles.moodsTop]}>
            {(moods.data ?? []).map((m) => (
              <MoodTile key={m.title} mood={m} onPress={() => (m.params ? router.push({ pathname: '/mood', params: { params: m.params, title: m.title } }) : submit(`${m.title} music`))} />
            ))}
          </View>
        </Animated.ScrollView>
      )}
      <SearchCard open={dropdownOpen} top={cardTop} rows={rows} onPick={submit} onRemove={forget} onClearAll={confirmClear} onClose={closeDropdown} onShown={setCardShown} />
      <TabHeader
        title="Search"
        scrollY={scrollY}
        left={<AvatarMenu />}
        right={<MicButton voice={voice} />}
        bar={
          <View ref={fieldRef as never} collapsable={false} style={[styles.inputWrap, cardShown && styles.inputWrapOpen]}>
                  <SymbolView name="magnifyingglass" size={18} tintColor={theme.colors.textSecondary} />
                  <TextInput
                    style={styles.input}
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={() => submit(input)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={voice.state === 'listening' ? 'Listening…' : voice.state === 'denied' ? 'Allow microphone and speech access in Settings' : 'What do you want to listen to?'}
                    placeholderTextColor={theme.colors.textSecondary}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Search input"
                  />
                  {input ? (
                    <Pressable hitSlop={10} onPress={clear} accessibilityRole="button" accessibilityLabel="Clear search">
                      <SymbolView name="xmark.circle.fill" size={18} tintColor={theme.colors.textTertiary} />
                    </Pressable>
                  ) : null}
                </View>
        }
      />
    </Screen>
  );
}

function MicButton({ voice }: { voice: ReturnType<typeof useVoiceSearch> }) {
  const { theme } = useUnistyles();
  const listening = voice.state === 'listening';
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.set(listening ? withRepeat(withSequence(withTiming(1.25, { duration: 500 }), withTiming(1, { duration: 500 })), -1) : withTiming(1));
  }, [listening, pulse]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  return (
    <Pressable
      style={[styles.mic, listening && { backgroundColor: theme.colors.accent }]}
      onPress={() => (listening ? voice.stop() : void voice.start())}
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop voice search' : 'Voice search'}>
      <Animated.View style={anim}>
        <SymbolView name={listening ? 'mic.fill' : 'mic'} size={18} tintColor={listening ? '#000' : theme.colors.text} />
      </Animated.View>
    </Pressable>
  );
}

function MoodTile({ mood, onPress }: { mood: Mood; onPress: () => void }) {
  // The picture is saved on the device and filled in one page at a time (loadMoodArt), never 35 fetches at once.
  const url = useMoodArt(mood.params);
  const color = tileColor(mood.title, mood.color);
  const shapes = useMemo(() => tileShapes(mood.title, color), [mood.title, color]);
  return (
    <Pressable style={[styles.mood, { backgroundColor: color }]} onPressIn={() => prefetchMood(mood.params)} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Browse ${mood.title}`}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice" pointerEvents="none">
        {shapes.map((sh, i) => (
          <Path key={i} d={sh.d} fill={sh.fill} fillOpacity={sh.opacity} />
        ))}
      </Svg>
      <SymbolView name={moodIcon(mood.title) as never} size={18} tintColor="rgba(255,255,255,0.85)" style={styles.moodIcon} />
      <Text style={styles.moodText} numberOfLines={2}>
        {mood.title}
      </Text>
      {url ? <Image source={{ uri: url }} style={styles.moodArt} contentFit="cover" /> : null}
    </Pressable>
  );
}

function TopResult({ item, onOpen }: { item: MusicItem; onOpen: () => void }) {
  return (
    <Pressable
      style={styles.top}
      onPress={() => (onOpen(), item.kind === 'track' ? playSong([item], 0, { source: 'search' }) : openItem(item))}
      onLongPress={() => itemSheet(item)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Top result ${itemTitle(item)}`}>
      <View style={styles.topHead}>
        <Artwork art={item.artwork} size={88} round={item.kind === 'artist'} />
        <MoreButton label={`More options for ${itemTitle(item)}`} onPress={() => itemSheet(item)} style={styles.topMore} />
      </View>
      <Text style={styles.topTitle} numberOfLines={2}>
        {itemTitle(item)}
      </Text>
      <Text style={styles.topSub} numberOfLines={1}>
        {itemSubtitle(item)}
      </Text>
    </Pressable>
  );
}

function ResultSkeleton() {
  return (
    <View style={styles.skel}>
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={styles.skelRow}>
          <Skeleton width={48} height={48} />
          <View style={styles.skelText}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  mic: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginHorizontal: theme.spacing.lg, paddingHorizontal: theme.spacing.lg, height: 48, borderRadius: theme.radii.full, backgroundColor: '#363636', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  input: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
  inputWrapOpen: { backgroundColor: 'transparent', borderColor: 'transparent' },
  list: { paddingBottom: theme.spacing.xl },
  chips: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.xs, gap: theme.spacing.sm },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.xs },
  recentTitle: { color: theme.colors.text, ...theme.typography.heading },
  clear: { color: theme.colors.textSecondary, ...theme.typography.body },
  suggestionRow: { flexDirection: 'row', alignItems: 'center' },
  removeRecent: { padding: theme.spacing.lg },
  dropdown: { position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, zIndex: 20, backgroundColor: theme.colors.surfaceHigh, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, borderWidth: 1, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', paddingTop: theme.spacing.xs, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  listening: { color: theme.colors.accent, ...theme.typography.bodyLarge },
  suggestion: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  suggestionText: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: theme.spacing.lg },
  moodsTop: { paddingTop: theme.spacing.sm },
  mood: { width: '47.5%', aspectRatio: 1.6, borderRadius: theme.radii.md, padding: 14, overflow: 'hidden', justifyContent: 'space-between' },
  moodIcon: { width: 18, height: 18 },
  moodText: { color: '#fff', ...theme.typography.title, fontWeight: '800', fontSize: 20, lineHeight: 24, maxWidth: '75%' },
  moodArt: { position: 'absolute', right: -14, bottom: -10, width: 72, height: 72, borderRadius: 6, transform: [{ rotate: '25deg' }], shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  topHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  topMore: { marginTop: -8, marginRight: -8 },
  top: { marginHorizontal: theme.spacing.lg, padding: theme.spacing.lg, gap: theme.spacing.sm, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceHigh },
  topTitle: { color: theme.colors.text, ...theme.typography.display, fontSize: 24, lineHeight: 30, marginTop: theme.spacing.sm },
  topSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  skel: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  skelRow: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' },
  skelText: { flex: 1, gap: theme.spacing.sm },
  footer: { margin: theme.spacing.lg },
}));
