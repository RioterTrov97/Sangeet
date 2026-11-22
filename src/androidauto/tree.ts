import type { MediaItem } from 'react-native-nitro-player';

import { pickArtwork } from '../youtube/mappers/common';
import type { Album, Artist, MusicItem, Playlist, Shelf, Track } from '../youtube/models';

/**
 * Pure builder for the Android Auto browse tree (no React, no native calls, so it is unit-tested and runs on a launch from the car).
 * Same shape as CarPlay (src/carplay): Home, Library, Recents, Downloads. Folders are published with `children: []` and loaded
 * lazily (`AndroidAutoMediaLibraryHelper.setChildrenLoader`); a list of songs is a native playlist (`playlistId`), and the car plays
 * a song from it as `${playlistId}:${trackId}`.
 *
 * Node ids: `home`, `library`, `recents`, `downloads` (tabs); `open:<album|artist|playlist>:<id>`; `lib:<liked|playlists|albums|artists>`;
 * `shelf:<n>` (a Home shelf of albums / playlists); `dgroup:<kind>:<id>`; `searches` (recent searches); `search:<query>` (its
 * results); `ctx:<key>` is a song list (native playlist).
 */

/** Android Auto shows long lists poorly and slowly: cap every list. */
export const MAX_ITEMS = 100;

export type Art = Track['artwork'];
const art = (a: Art): string | undefined => pickArtwork(a, 300);
const artists = (t: Track) => t.artists.map((a) => a.name).join(', ');

/** What a node resolves to: more nodes (folders and song lists), or the songs of one list. */
export type Node =
  | { kind: 'folder'; id: string; title: string; subtitle?: string; art?: Art }
  /** A song list shown as a playlist item; opening it lists `tracks`, playing starts there. */
  | { kind: 'songs'; ctx: string; title: string; subtitle?: string; art?: Art; tracks: Track[] };

export const TABS = [
  { id: 'home', title: 'Home' },
  { id: 'library', title: 'Library' },
  { id: 'recents', title: 'Recents' },
  { id: 'downloads', title: 'Downloads' },
] as const;

/** The root: lazy folders. */
export function buildRoot(): MediaItem[] {
  return TABS.map((t) => ({ id: t.id, title: t.title, isPlayable: false, mediaType: 'folder', children: [], layoutType: 'list' }));
}

export const playlistName = (ctx: string) => `aa:${ctx}`;
export const isAaPlaylistName = (name: string | undefined) => !!name && name.startsWith('aa:');

const tracksOf = (items: MusicItem[]): Track[] => items.filter((x): x is Track => x.kind === 'track');
const isQuick = (s: Shelf) => /quick picks/i.test(s.title);

const songsNode = (ctx: string, title: string, tracks: Track[], subtitle?: string, a?: Art): Node => ({ kind: 'songs', ctx, title, subtitle: subtitle ?? `${tracks.length} songs`, art: a ?? tracks[0]?.artwork, tracks: tracks.slice(0, MAX_ITEMS) });

const collectionNode = (x: Album | Artist | Playlist): Node => ({
  kind: 'folder',
  id: `open:${x.kind}:${x.id}`,
  title: x.kind === 'artist' ? x.name : x.title,
  subtitle: x.kind === 'album' ? x.artists.map((a) => a.name).join(', ') : x.kind === 'artist' ? x.subtitle : (x.author ?? x.subtitle),
  art: x.artwork,
});

/** Home: Continue, then Quick picks and each Home shelf (song shelves are playable lists, album and playlist shelves are folders). */
export function homeNodes(d: { shelves?: Shelf[]; resume?: Track; recents: Track[]; searches?: string[] }): Node[] {
  const nodes: Node[] = [];
  if (d.resume) nodes.push(songsNode('continue', 'Continue listening', [d.resume], d.resume.title, d.resume.artwork));
  if (d.recents.length) nodes.push(songsNode('recents', 'Recently played', d.recents));
  if (recentSearchNodes(d.searches ?? []).length) nodes.push({ kind: 'folder', id: 'searches', title: 'Recent searches', subtitle: d.searches?.find((q) => q.trim()) });
  const shelves = d.shelves ?? [];
  shelves.forEach((s, i) => {
    const tracks = tracksOf(s.items);
    if (tracks.length >= 3) return void nodes.push(songsNode(`home:${i}`, isQuick(s) ? 'Quick picks' : s.title, tracks, s.title === 'Quick picks' ? undefined : 'Songs'));
    const cols = s.items.filter((x): x is Album | Artist | Playlist => x.kind !== 'track');
    if (cols.length) nodes.push({ kind: 'folder', id: `shelf:${i}`, title: s.title, subtitle: `${Math.min(cols.length, MAX_ITEMS)} items`, art: cols[0].artwork });
  });
  return nodes.slice(0, MAX_ITEMS);
}

/** The collections of one Home shelf. */
export function shelfNodes(shelves: Shelf[] | undefined, n: number): Node[] {
  const s = shelves?.[n];
  return s ? s.items.filter((x): x is Album | Artist | Playlist => x.kind !== 'track').slice(0, MAX_ITEMS).map(collectionNode) : [];
}

export type LibraryData = {
  liked: Track[];
  playlists: { id: string; name: string; artwork: Art; subtitle?: string }[];
  albums: { id: string; name: string; artwork: Art }[];
  artists: { id: string; name: string; artwork: Art }[];
};

export function libraryNodes(d: LibraryData): Node[] {
  const nodes: Node[] = [];
  if (d.liked.length) nodes.push(songsNode('liked', 'Liked Songs', d.liked));
  if (d.playlists.length) nodes.push({ kind: 'folder', id: 'lib:playlists', title: 'Playlists', subtitle: `${d.playlists.length}`, art: d.playlists[0].artwork });
  if (d.albums.length) nodes.push({ kind: 'folder', id: 'lib:albums', title: 'Albums', subtitle: 'Recently played and saved', art: d.albums[0].artwork });
  if (d.artists.length) nodes.push({ kind: 'folder', id: 'lib:artists', title: 'Artists', subtitle: 'Recently played and followed', art: d.artists[0].artwork });
  return nodes;
}

/** Library > Playlists / Albums / Artists. Playlist ids starting `local:` are the phone's own playlists (loaded from the library store). */
export function libraryListNodes(which: string, d: LibraryData): Node[] {
  switch (which) {
    case 'playlists':
      return d.playlists.slice(0, MAX_ITEMS).map((p) => ({ kind: 'folder' as const, id: `open:playlist:${p.id}`, title: p.name, subtitle: p.subtitle, art: p.artwork }));
    case 'albums':
      return d.albums.slice(0, MAX_ITEMS).map((a) => ({ kind: 'folder' as const, id: `open:album:${a.id}`, title: a.name, art: a.artwork }));
    case 'artists':
      return d.artists.slice(0, MAX_ITEMS).map((a) => ({ kind: 'folder' as const, id: `open:artist:${a.id}`, title: a.name, art: a.artwork }));
    default:
      return [];
  }
}

export type DownloadsData = { tracks: Track[]; groups: { kind: string; id: string; name: string; count: number; artwork: Art }[] };

export function downloadsNodes(d: DownloadsData): Node[] {
  if (!d.tracks.length) return [];
  return [
    songsNode('downloads', 'All downloads', d.tracks),
    ...d.groups.slice(0, 20).map((g): Node => ({ kind: 'folder', id: `dgroup:${g.kind}:${g.id}`, title: g.name, subtitle: `${g.kind === 'album' ? 'Album' : 'Playlist'} · ${g.count} songs`, art: g.artwork })),
  ];
}

/** An id the loader receives. `open:album:MPREb_x` -> {what:'album', id:'MPREb_x'}; ids may contain colons after the second one. */
export function parseOpen(id: string): { what: 'album' | 'artist' | 'playlist'; id: string } | undefined {
  const m = /^open:(album|artist|playlist):(.+)$/.exec(id);
  return m ? { what: m[1] as 'album' | 'artist' | 'playlist', id: m[2] } : undefined;
}

/** What the car's browser needs for a node: a folder row, a playlist row, or (inside a list) one playable song per track. */
export function toItems(nodes: Node[], playlistIdFor: (ctx: string) => string | undefined): MediaItem[] {
  const out: MediaItem[] = [];
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.push({ id: n.id, title: n.title, subtitle: n.subtitle, iconUrl: n.art ? art(n.art) : undefined, isPlayable: false, mediaType: 'folder', children: [], layoutType: 'list' });
      continue;
    }
    const playlistId = playlistIdFor(n.ctx);
    if (!playlistId) continue;
    out.push({ id: `list:${n.ctx}`, title: n.title, subtitle: n.subtitle, iconUrl: n.art ? art(n.art) : undefined, isPlayable: false, mediaType: 'playlist', playlistId });
  }
  return out;
}

/** The songs of one opened list (an album, a playlist, an artist's top songs): playable rows of its native playlist. */
export function songItems(playlistId: string, tracks: Track[]): MediaItem[] {
  return tracks.slice(0, MAX_ITEMS).map((t) => ({ id: `${playlistId}:${t.id}`, title: t.title, subtitle: artists(t), iconUrl: art(t.artwork), isPlayable: true, mediaType: 'audio' }));
}

/** Android Auto shows at most a handful of rows per search result block; keep results short so they read while driving. */
export const MAX_SEARCH_SONGS = 15;
export const MAX_SEARCH_COLLECTIONS = 6;
export const MAX_RECENT_SEARCHES = 8;

/** Home > Recent searches: the phone's (and the car's) last searches, newest first; each opens its results. */
export function recentSearchNodes(queries: string[]): Node[] {
  return queries
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, MAX_RECENT_SEARCHES)
    .map((q) => ({ kind: 'folder' as const, id: `search:${q}`, title: q, subtitle: 'Search' }));
}

/** The query in a `search:<q>` node id. */
export const parseSearch = (id: string): string | undefined => (id.startsWith('search:') && id.length > 7 ? id.slice(7) : undefined);

/**
 * Search results for the car (the search button, or a recent search): the top songs as playable rows of one native playlist,
 * then a few albums and artists as folders. Songs come first: that is what a driver usually wants.
 */
export function searchItems(playlistId: string | undefined, tracks: Track[], collections: (Album | Artist | Playlist)[]): MediaItem[] {
  const songs = playlistId ? songItems(playlistId, tracks.slice(0, MAX_SEARCH_SONGS)) : [];
  const cols = toItems(collections.filter((c) => c.kind === 'album' || c.kind === 'artist').slice(0, MAX_SEARCH_COLLECTIONS).map(collectionNode), () => undefined);
  return [...songs, ...cols];
}
