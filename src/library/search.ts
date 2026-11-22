import type { Artist, Track } from '../youtube/models';
import type { SavedItem } from './store';

/** Lower-case and strip diacritics ("Beyoncé" -> "beyonce"). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** True when every word of `query` is a substring of one of `fields` (case and diacritics ignored). An empty query matches everything. */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter((f): f is string => !!f).map(fold).join(' \u0000 ');
  return words.every((w) => hay.includes(w));
}

export const trackMatches = (q: string, t: Track): boolean => matchesQuery(q, t.title, ...t.artists.map((a) => a.name), t.album?.name);

export function savedMatches(q: string, x: SavedItem): boolean {
  switch (x.kind) {
    case 'artist': return matchesQuery(q, x.name);
    case 'album': return matchesQuery(q, x.title, ...x.artists.map((a) => a.name));
    default: return matchesQuery(q, x.title, x.author);
  }
}

export type LocalPl = { id: string; name: string };

export type LibrarySearchInput = {
  liked: Track[];
  downloads: Track[];
  /** Songs from this iPhone. */
  local?: Track[];
  saved: SavedItem[];
  playlists: LocalPl[];
};

export type LibrarySearchResult<P extends LocalPl = LocalPl> = {
  songs: Track[];
  albums: SavedItem[];
  playlists: SavedItem[];
  localPlaylists: P[];
  artists: Artist[];
};

/** Filters the user's own library (liked, downloaded and on-device songs, saved albums / playlists / artists, local playlists) by `query`. */
export function searchLibrary<P extends LocalPl>(query: string, input: Omit<LibrarySearchInput, 'playlists'> & { playlists: P[] }): LibrarySearchResult<P> {
  const seen = new Set<string>();
  const songs = [...input.liked, ...input.downloads, ...(input.local ?? [])].filter((t) => !seen.has(t.id) && trackMatches(query, t) && !!seen.add(t.id));
  const hits = input.saved.filter((x) => savedMatches(query, x));
  return {
    songs,
    albums: hits.filter((x) => x.kind === 'album'),
    playlists: hits.filter((x) => x.kind === 'playlist'),
    localPlaylists: input.playlists.filter((p) => matchesQuery(query, p.name)),
    artists: hits.filter((x): x is Artist => x.kind === 'artist'),
  };
}
