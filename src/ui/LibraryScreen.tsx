import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { autoCachedTracks, useAutoCache } from '../downloads/autoCache';
import { downloadedTracks, useDownloads } from '../downloads/manager';
import { libraryItems, normalizeSort, playedAtMaps, SORT_OPTIONS, sortEntries, sortLabel, sortSongs, type Sortable, type SortKey } from '../library/items';
import { usePins } from '../library/pins';
import { useLocalSongs, localTracks } from '../local';
import { importSongsFromFiles } from '../local/import';
import { searchLibrary } from '../library/search';
import { createLocalPlaylist, lastPlayedBySource, useLibraryStore, type LocalPlaylist, type SavedItem } from '../library/store';
import { playTracks, togglePlay } from '../player';
import { getHistory, getPlays, onHistoryChange } from '../player/history';
import { usePlayerStore } from '../player/store';
import { getJson, setJson } from '../util/storage';
import type { Track } from '../youtube/models';
import { entryKey, entrySheet, entrySource, entryTitle, playEntry, type Entry } from './actions';
import { Artwork } from './Artwork';
import { Chip, IconButton } from './Controls';
import { AvatarMenu } from './AvatarMenu';
import { useFloatingInset } from './floating';
import { itemSubtitle } from './itemText';
import { Screen, TabHeader, useTabTop } from './Layout';
import { MoreButton } from './MoreButton';
import { openItem } from './nav';
import { PlaylistCover } from './PlaylistCover';
import { AnimatedFlashList, useScrollY } from './scroll';
import { openActionSheet } from './sheet';
import { playSong } from './playSong';
import { openSpotifyImport } from './SpotifyImport';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';

type Filter = 'songs' | 'downloads' | 'playlists' | 'albums' | 'artists';
const FILTERS: { key: Filter | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'songs', label: 'Songs' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
];
const PREFS = 'library.prefs';

type Row =
  | { type: 'entry'; entry: Entry; sub: string; pinned: boolean }
  | { type: 'header'; title: string; sub?: string }
  | { type: 'playbar'; tracks: Track[]; source: string; name: string }
  | { type: 'song'; track: Track; list: Track[]; source: string }
  | { type: 'note'; text: string };

type Meta = Sortable & { entry: Entry; sub: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const newPlaylist = () => Alert.prompt('New playlist', 'Give it a name', (n) => n?.trim() && createLocalPlaylist(n), 'plain-text', '');

export function LikedTile({ size, count }: { size: number; count: number }) {
  return (
    <LinearGradient colors={['#4500F5', '#8E8CF5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.likedArt, { width: size, height: size }]}>
      <SymbolView name="heart.fill" size={size * 0.4} tintColor="#fff" accessibilityLabel={`${count} liked songs`} />
    </LinearGradient>
  );
}

const subtitleOf = (e: Entry, likedCount: number, dl: { manual: number; auto: number }, deviceCount: number): string => {
  switch (e.kind) {
    case 'device': return plural(deviceCount, 'song');
    case 'liked': return `Playlist • ${plural(likedCount, 'song')}`;
    case 'downloads': return plural(dl.manual + dl.auto, 'song') + (dl.auto ? ` • ${dl.auto} saved automatically` : '');
    case 'local': return `Playlist • ${plural(e.pl.count, 'track')}`;
    case 'album': return ['Album', e.artists.map((a) => a.name).join(', ')].filter(Boolean).join(' • ');
    case 'artist': return 'Artist';
    default: return itemSubtitle(e) ?? '';
  }
};

const goSearch = () => router.navigate('/(tabs)/search' as never);

export function LibraryScreen() {
  const floatInset = useFloatingInset();
  const { scrollY, onScroll } = useScrollY();
  const top = useTabTop(true);
  const { theme } = useUnistyles();
  const saved = useLibraryStore((s) => s.saved);
  const savedAt = useLibraryStore((s) => s.savedAt);
  const playlists = useLibraryStore((s) => s.playlists);
  const likedSongs = useLibraryStore((s) => s.liked);
  const pins = usePins((s) => s.keys);
  const dlRev = useDownloads((s) => s.rev);
  const autoIds = useAutoCache((s) => s.ids);
  const deviceSongs = useLocalSongs((s) => s.songs);
  const [histRev, setHistRev] = useState(0);
  useEffect(() => onHistoryChange(() => setHistRev((n) => n + 1)), []);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const prefs = useMemo(() => getJson<{ grid: boolean; sort?: string }>(PREFS) ?? { grid: false }, []);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [grid, setGrid] = useState(prefs.grid);
  const [sort, setSort] = useState<SortKey>(normalizeSort(prefs.sort));
  const savePrefs = (g: boolean, s: SortKey) => setJson(PREFS, { grid: g, sort: s });

  const rows = useMemo<Row[]>(() => {
    const manual = downloadedTracks();
    const autoN = autoCachedTracks().length;
    const likedCount = likedSongs.length;
    const deviceCount = Object.keys(deviceSongs).length;
    const history = getHistory();
    const bySource = lastPlayedBySource();
    const played = playedAtMaps(getPlays(365));
    const pinned = new Set(pins);
    const playedAt = (e: Entry): number => {
      switch (e.kind) {
        case 'album': return Math.max(bySource[`album:${e.id}`] ?? 0, played.albums[e.id] ?? 0);
        case 'artist': return Math.max(bySource[`artist:${e.id}`] ?? 0, played.artists[e.id] ?? 0);
        case 'playlist': return bySource[`playlist:${e.id}`] ?? 0;
        case 'local': return bySource[`local:${e.pl.id}`] ?? 0;
        case 'liked': return bySource.liked ?? 0;
        case 'downloads': return bySource.downloads ?? 0;
        case 'device': return bySource.device ?? 0;
        default: return 0;
      }
    };
    // Liked Songs, Downloads and On this iPhone sit at the top under the default sort and are ordinary entries under any other.
    const atTop = sort === 'recents';
    const meta = (e: Entry, addedAt: number, count?: number): Meta => ({
      entry: e,
      title: entryTitle(e),
      addedAt,
      playedAt: atTop && e.kind === 'liked' ? Number.MAX_SAFE_INTEGER : atTop && e.kind === 'downloads' ? Number.MAX_SAFE_INTEGER - 1 : atTop && e.kind === 'device' ? Number.MAX_SAFE_INTEGER - 2 : playedAt(e),
      count,
      pinned: pinned.has(entryKey(e)),
      sub: subtitleOf(e, likedCount, { manual: manual.length, auto: autoN }, deviceCount),
    });
    const toRows = (list: Meta[]): Row[] => sortEntries(list, sort).map((m) => ({ type: 'entry', entry: m.entry, sub: m.sub, pinned: !!m.pinned }));
    const savedMeta = (list: SavedItem[]) => list.map((x) => meta(x, savedAt[`${x.kind}-${x.id}`] ?? playedAt(x)));
    const localMeta = (list: LocalPlaylist[]) => list.map((pl) => meta({ kind: 'local', pl }, pl.createdAt, pl.count));
    const section = (title: string, list: Row[]): Row[] => (list.length ? [{ type: 'header', title }, ...list] : []);

    if (q) {
      const r = searchLibrary(q, { liked: likedSongs, downloads: manual, local: localTracks(), saved: libraryItems(null, saved, history, 'recent'), playlists });
      const byId = new Map(playlists.map((p) => [p.id, p]));
      const songs = sortSongs(r.songs, sort);
      return [
        ...section('Playlists', toRows([...localMeta(r.localPlaylists.map((p) => byId.get(p.id)!).filter(Boolean)), ...savedMeta(r.playlists)])),
        ...section('Albums', toRows(savedMeta(r.albums))),
        ...section('Artists', toRows(savedMeta(r.artists))),
        ...section('Songs', songs.map((track) => ({ type: 'song' as const, track, list: songs, source: 'search-library' }))),
      ];
    }

    if (filter === 'songs') {
      const songs = sortSongs(likedSongs, sort);
      if (!songs.length) return [];
      return [{ type: 'playbar', tracks: songs, source: 'liked', name: 'Liked Songs' }, ...songs.map((track) => ({ type: 'song' as const, track, list: songs, source: 'liked' }))];
    }
    if (filter === 'downloads') {
      const auto = autoCachedTracks();
      const all = [...manual, ...auto];
      if (!all.length) return [];
      const out: Row[] = [];
      if (all.length) out.push({ type: 'playbar', tracks: all, source: 'downloads', name: 'Downloads' });
      out.push({ type: 'header', title: 'Downloaded', sub: manual.length ? plural(manual.length, 'song') : undefined });
      if (!manual.length) out.push({ type: 'note', text: 'Songs, albums and playlists you download show up here.' });
      else out.push(...manual.map((track) => ({ type: 'song' as const, track, list: all, source: 'downloads' })));
      if (auto.length) out.push({ type: 'header', title: 'Saved automatically', sub: plural(auto.length, 'song') }, ...auto.map((track) => ({ type: 'song' as const, track, list: all, source: 'downloads' })));
      return out;
    }

    const savedOf = (kind: SavedItem['kind']) => saved.filter((x) => x.kind === kind);
    const liked = meta({ kind: 'liked' }, 0, likedCount);
    const downloads = meta({ kind: 'downloads' }, 0, manual.length + autoN);
    const device = meta({ kind: 'device' }, 0, deviceCount);
    let list: Meta[];
    if (filter === 'playlists') list = [liked, ...localMeta(playlists), ...savedMeta(savedOf('playlist'))];
    else if (filter === 'albums') list = savedMeta(libraryItems('albums', savedOf('album'), history, 'recent'));
    else if (filter === 'artists') list = savedMeta(libraryItems('artists', savedOf('artist'), history, 'recent'));
    else list = [liked, downloads, device, ...localMeta(playlists), ...savedMeta(saved)];
    return toRows(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, saved, savedAt, sort, playlists, dlRev, autoIds, deviceSongs, q, likedSongs, pins, histRev]);

  const showGrid = grid && !q && filter !== 'songs' && filter !== 'downloads';
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  const openSort = () =>
    openActionSheet({
      header: { title: 'Sort by' },
      actions: SORT_OPTIONS.map((o) => ({
        id: o.key,
        label: o.label,
        icon: o.key === 'recents' ? 'clock' : o.key === 'added' ? 'calendar.badge.plus' : o.key === 'oldest' ? 'calendar' : o.key === 'az' ? 'textformat' : 'number',
        checked: o.key === sort,
        onPress: () => {
          setSort(o.key);
          savePrefs(grid, o.key);
        },
      })),
    });

  return (
    <Screen top="under">
      <TabHeader
        title="Your Library"
        scrollY={scrollY}
        left={<AvatarMenu />}
        right={
          <>
            <IconButton name="magnifyingglass" label="Search your library" active={searching} onPress={() => (searching ? closeSearch() : setSearching(true))} />
            <Pressable
              onPress={() =>
                openActionSheet({
                  actions: [
                    { id: 'new', label: 'New playlist', icon: 'plus', onPress: newPlaylist },
                    { id: 'import', label: 'Import from Spotify', icon: 'square.and.arrow.down', onPress: openSpotifyImport },
                    { id: 'songs', label: 'Import songs', icon: 'iphone', afterGone: true, onPress: () => void importSongsFromFiles() },
                  ],
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Create or import a playlist">
              <SymbolView name="plus" size={22} tintColor={theme.colors.text} />
            </Pressable>
          </>
        }
        bar={
          searching ? (
            <View style={styles.searchRow}>
              <View style={styles.inputWrap}>
                <SymbolView name="magnifyingglass" size={16} tintColor={theme.colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  placeholder="Search your library"
                  placeholderTextColor={theme.colors.textSecondary}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Search your library"
                />
                {query ? (
                  <Pressable hitSlop={10} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                    <SymbolView name="xmark.circle.fill" size={16} tintColor={theme.colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable hitSlop={8} onPress={closeSearch} accessibilityRole="button" accessibilityLabel="Cancel search">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f.label} label={f.label} selected={filter === f.key} onPress={() => setFilter(filter === f.key ? null : f.key)} />
              ))}
            </ScrollView>
          )
        }
      />
      <AnimatedFlashList
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View style={styles.toolbar}>
            <Pressable style={styles.sort} onPress={openSort} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Sort: ${sortLabel(sort)}. Tap to change`}>
              <SymbolView name="arrow.up.arrow.down" size={14} tintColor={theme.colors.text} />
              <Text style={styles.sortText}>{sortLabel(sort)}</Text>
            </Pressable>
            {filter === 'songs' || filter === 'downloads' ? null : (
              <IconButton
                name={grid ? 'list.bullet' : 'square.grid.2x2'}
                size={18}
                label={grid ? 'Show as list' : 'Show as grid'}
                onPress={() => {
                  setGrid(!grid);
                  savePrefs(!grid, sort);
                }}
              />
            )}
          </View>
        }
        ListFooterComponent={q || filter === 'songs' || filter === 'downloads' ? null : (
          <View style={styles.quick}>
            <Pill icon="plus" label="Playlist" onPress={newPlaylist} />
            <Pill icon="square.and.arrow.down" label="Import" onPress={openSpotifyImport} />
          </View>
        )}
        key={showGrid ? 'grid' : 'list'}
        data={rows}
        numColumns={showGrid ? 2 : 1}
        keyExtractor={rowKey}
        getItemType={(r: Row) => r.type}
        contentContainerStyle={[showGrid ? styles.gridContent : styles.listContent, { paddingTop: top, paddingBottom: floatInset }]}
        renderItem={({ item: r }: { item: Row }) => <RowView row={r} grid={showGrid} />}
        ListEmptyComponent={
          q ? (
            <EmptyState icon="magnifyingglass" title={`No matches for "${q}"`} body="Searches your liked songs, saved albums, playlists, artists, downloads and songs from this iPhone." />
          ) : filter === 'songs' ? (
            <EmptyState art="rows" icon="heart.fill" tone="liked" title="Songs you like live here" body="Tap the heart on any song to save it here." action={{ label: 'Find something to like', onPress: goSearch }} />
          ) : filter === 'downloads' ? (
            <EmptyState art="rows" icon="arrow.down.circle" tone="downloads" title="No downloads yet" body="Download songs and albums to listen without a connection." action={{ label: 'Browse music', onPress: goSearch }} />
          ) : (
            <EmptyState icon="books.vertical" title="Your library is empty" body="Like songs and save albums, artists and playlists to find them here." action={{ label: 'Browse music', onPress: goSearch }} />
          )
        }
      />
    </Screen>
  );
}

function Pill({ icon, label, onPress }: { icon: 'plus' | 'square.and.arrow.down'; label: string; onPress: () => void }) {
  const { theme } = useUnistyles();
  return (
    <Pressable style={styles.pill} onPress={onPress} accessibilityRole="button" accessibilityLabel={label === 'Import' ? 'Import from Spotify' : `New ${label.toLowerCase()}`}>
      <SymbolView name={icon} size={16} tintColor={theme.colors.text} />
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const rowKey = (r: Row, i: number) => {
  switch (r.type) {
    case 'entry': return entryKey(r.entry);
    case 'song': return `s-${r.track.id}-${i}`;
    case 'header': return `h-${r.title}`;
    default: return `${r.type}-${i}`;
  }
};

const openEntry = (e: Entry) => {
  if (e.kind === 'liked') router.push('/liked');
  else if (e.kind === 'downloads') router.push('/downloads' as never);
  else if (e.kind === 'device') router.push('/on-device' as never);
  else if (e.kind === 'local') router.push({ pathname: '/local/[id]', params: { id: e.pl.id } });
  else openItem(e);
};

function EntryArt({ entry, size }: { entry: Entry; size: number }) {
  const { theme } = useUnistyles();
  const liked = useLibraryStore((s) => s.liked.length);
  switch (entry.kind) {
    case 'liked': return <LikedTile size={size} count={liked} />;
    case 'downloads':
      return (
        <View style={[styles.likedArt, { width: size, height: size, backgroundColor: theme.colors.surfaceElevated }]}>
          <SymbolView name="arrow.down.circle" size={size * 0.4} tintColor={theme.colors.accent} />
        </View>
      );
    case 'device':
      return (
        <View style={[styles.likedArt, { width: size, height: size, backgroundColor: theme.colors.surfaceElevated }]}>
          <SymbolView name="iphone" size={size * 0.4} tintColor={theme.colors.accent} />
        </View>
      );
    case 'local': return <PlaylistCover art={entry.pl.art} size={size} />;
    case 'track': return <Artwork art={entry.artwork} size={size} />;
    default: return <Artwork art={entry.artwork} size={size} round={entry.kind === 'artist'} />;
  }
}

/** White round play button; shows pause while this entry is what is playing. */
function PlayCircle({ entry }: { entry: Entry }) {
  const source = entrySource(entry);
  const state = usePlayerStore((s) => (s.source === source ? (s.status === 'playing' || s.status === 'buffering' ? 2 : 1) : 0));
  return (
    <Pressable
      style={styles.playCircle}
      hitSlop={6}
      onPress={() => (state ? void togglePlay() : void playEntry(entry))}
      accessibilityRole="button"
      accessibilityLabel={state === 2 ? `Pause ${entryTitle(entry)}` : `Play ${entryTitle(entry)}`}>
      <SymbolView name={state === 2 ? 'pause.fill' : 'play.fill'} size={16} tintColor="#000" />
    </Pressable>
  );
}

const RowView = memo(function RowView({ row, grid }: { row: Row; grid: boolean }) {
  const { theme } = useUnistyles();
  switch (row.type) {
    case 'header':
      return (
        <View style={styles.headerRow}>
          <Text style={styles.header} accessibilityRole="header">{row.title}</Text>
          {row.sub ? <Text style={styles.headerSub}>{row.sub}</Text> : null}
        </View>
      );
    case 'note':
      return <Text style={styles.note}>{row.text}</Text>;
    case 'song':
      return <TrackRow track={row.track} onPress={() => playSong(row.list, row.list.findIndex((t) => t.id === row.track.id), { source: row.source })} />;
    case 'playbar':
      return (
        <View style={styles.playbar}>
          <Pressable style={[styles.bigPill, styles.bigPillOn]} onPress={() => void playTracks(row.tracks, 0, { source: row.source, sourceName: row.name })} accessibilityRole="button" accessibilityLabel="Play">
            <SymbolView name="play.fill" size={16} tintColor="#000" />
            <Text style={styles.bigPillOnText}>Play</Text>
          </Pressable>
          <Pressable style={styles.bigPill} onPress={() => void playTracks(row.tracks, 0, { source: row.source, sourceName: row.name, shuffle: true })} accessibilityRole="button" accessibilityLabel="Shuffle">
            <SymbolView name="shuffle" size={16} tintColor={theme.colors.text} />
            <Text style={styles.bigPillText}>Shuffle</Text>
          </Pressable>
        </View>
      );
    case 'entry': {
      const e = row.entry;
      const title = entryTitle(e);
      if (grid) {
        return (
          <Pressable style={styles.cell} onPress={() => openEntry(e)} onLongPress={() => entrySheet(e, { library: true })} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`${title}, ${row.sub}`}>
            <View style={e.kind === 'artist' ? styles.centered : undefined}>
              <EntryArt entry={e} size={152} />
            </View>
            <Text style={[styles.rowTitle, e.kind === 'artist' && styles.centerText]} numberOfLines={1}>{title}</Text>
            <View style={styles.subLine}>
              {row.pinned ? <SymbolView name="pin.fill" size={11} tintColor={theme.colors.accent} /> : null}
              <Text style={[styles.rowSub, styles.flex]} numberOfLines={1}>{row.sub}</Text>
            </View>
          </Pressable>
        );
      }
      return (
        <Pressable style={styles.row} onPress={() => openEntry(e)} onLongPress={() => entrySheet(e, { library: true })} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`${title}, ${row.sub}`}>
          <EntryArt entry={e} size={60} />
          <View style={styles.text}>
            <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
            <View style={styles.subLine}>
              {row.pinned ? <SymbolView name="pin.fill" size={11} tintColor={theme.colors.accent} /> : null}
              <Text style={[styles.rowSub, styles.flex]} numberOfLines={1}>{row.sub}</Text>
            </View>
          </View>
          <PlayCircle entry={e} />
          <MoreButton label={`More options for ${title}`} onPress={() => entrySheet(e, { library: true })} style={styles.more} />
        </Pressable>
      );
    }
  }
});

const styles = StyleSheet.create((theme) => ({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, height: 40, borderRadius: theme.radii.full, backgroundColor: '#363636', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  input: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
  cancel: { color: theme.colors.text, ...theme.typography.body },
  chips: { paddingHorizontal: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.sm },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  sort: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  sortText: { color: theme.colors.text, ...theme.typography.body },
  listContent: { paddingBottom: theme.spacing.xl },
  gridContent: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingLeft: theme.spacing.lg, paddingRight: theme.spacing.xs, paddingVertical: theme.spacing.sm },
  text: { flex: 1 },
  flex: { flexShrink: 1 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowTitle: { color: theme.colors.text, ...theme.typography.heading },
  rowSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  playCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  more: { paddingHorizontal: 8 },
  cell: { alignItems: 'flex-start', padding: theme.spacing.sm, gap: 2 },
  centered: { alignSelf: 'center' },
  centerText: { alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  header: { color: theme.colors.text, ...theme.typography.title },
  headerSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  note: { color: theme.colors.textSecondary, ...theme.typography.body, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  likedArt: { borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  playbar: { flexDirection: 'row', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  bigPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, height: 44, borderRadius: 22, backgroundColor: theme.colors.surfaceElevated },
  bigPillOn: { backgroundColor: '#fff' },
  bigPillOnText: { color: '#000', ...theme.typography.heading },
  bigPillText: { color: theme.colors.text, ...theme.typography.heading },
  quick: { flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceElevated },
  pillText: { color: theme.colors.text, ...theme.typography.body },
}));
