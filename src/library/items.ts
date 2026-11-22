import { recentAlbums, recentArtists } from '../player/history';
import type { Album, Artist, Track } from '../youtube/models';
import type { SavedItem } from './store';

export type LibraryFilter = 'playlists' | 'albums' | 'artists' | 'downloaded';
export type LibrarySort = 'recent' | 'az';

const nameOf = (x: SavedItem) => (x.kind === 'artist' ? x.name : x.title);

/** Saved items plus, for albums and artists, things merely played. */
export function libraryItems(filter: LibraryFilter | null, saved: SavedItem[], history: Track[], sort: LibrarySort): SavedItem[] {
  let items: SavedItem[];
  const playedAlbums: Album[] = recentAlbums(history).map((a) => ({ kind: 'album', id: a.id, title: a.name, artists: [], artwork: a.artwork }));
  const playedArtists: Artist[] = recentArtists(history).map((a) => ({ kind: 'artist', id: a.id, name: a.name, artwork: a.artwork }));
  const dedupe = (list: SavedItem[]) => {
    const seen = new Set<string>();
    return list.filter((x) => (seen.has(`${x.kind}-${x.id}`) ? false : (seen.add(`${x.kind}-${x.id}`), true)));
  };
  if (filter === 'downloaded') return [];
  if (filter === 'playlists') items = saved.filter((x) => x.kind === 'playlist');
  else if (filter === 'albums') items = dedupe([...saved.filter((x) => x.kind === 'album'), ...playedAlbums]);
  else if (filter === 'artists') items = dedupe([...saved.filter((x) => x.kind === 'artist'), ...playedArtists]);
  else items = dedupe([...saved, ...playedAlbums, ...playedArtists]);
  return sort === 'az' ? [...items].sort((a, b) => nameOf(a).localeCompare(nameOf(b))) : items;
}

// ---- Library sorting (Lyra-style sort sheet) ----

export type SortKey = 'recents' | 'added' | 'oldest' | 'az' | 'count';
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recents', label: 'Recents' },
  { key: 'added', label: 'Recently added' },
  { key: 'oldest', label: 'Oldest added' },
  { key: 'az', label: 'Alphabetical' },
  { key: 'count', label: 'Track count' },
];
export const sortLabel = (k: SortKey) => SORT_OPTIONS.find((o) => o.key === k)?.label ?? 'Recents';

/** Reads a stored sort choice, mapping the legacy values 'recent' and 'az'. */
export function normalizeSort(v: unknown): SortKey {
  if (v === 'recent') return 'recents';
  return SORT_OPTIONS.some((o) => o.key === v) ? (v as SortKey) : 'recents';
}

export type Sortable = {
  title: string;
  /** When it was saved / created (ms); 0 when unknown. */
  addedAt: number;
  /** Last time something from it was played (ms); 0 = never. */
  playedAt: number;
  /** Track count; undefined sorts last. */
  count?: number;
  pinned?: boolean;
};

/** Pinned items first, then `key` order. Stable, never mutates. */
export function sortEntries<T extends Sortable>(list: T[], key: SortKey): T[] {
  const name = (a: T, b: T) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const cmp = (a: T, b: T): number => {
    switch (key) {
      case 'recents': return b.playedAt - a.playedAt || b.addedAt - a.addedAt || name(a, b);
      case 'added': return b.addedAt - a.addedAt || name(a, b);
      case 'oldest': return a.addedAt - b.addedAt || name(a, b);
      case 'az': return name(a, b);
      case 'count': {
        if (a.count === undefined || b.count === undefined) return a.count === b.count ? name(a, b) : a.count === undefined ? 1 : -1;
        return b.count - a.count || name(a, b);
      }
    }
  };
  return list
    .map((x, i) => ({ x, i }))
    .sort((p, q) => (q.x.pinned ? 1 : 0) - (p.x.pinned ? 1 : 0) || cmp(p.x, q.x) || p.i - q.i)
    .map((p) => p.x);
}

/** Songs (liked) under the sort: newest first by default; Oldest reverses, Alphabetical sorts by title. */
export function sortSongs<T extends { title: string }>(newestFirst: T[], key: SortKey): T[] {
  if (key === 'az') return [...newestFirst].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  if (key === 'oldest') return [...newestFirst].reverse();
  return newestFirst;
}

/** Latest play time per album id and per first-artist id from a play list (ms). */
export function playedAtMaps(plays: { track: Track; playedAt: number }[]): { albums: Record<string, number>; artists: Record<string, number> } {
  const albums: Record<string, number> = {};
  const artists: Record<string, number> = {};
  for (const { track, playedAt } of plays) {
    if (track.album?.id) albums[track.album.id] = Math.max(albums[track.album.id] ?? 0, playedAt);
    for (const a of track.artists) if (a.id) artists[a.id] = Math.max(artists[a.id] ?? 0, playedAt);
  }
  return { albums, artists };
}
