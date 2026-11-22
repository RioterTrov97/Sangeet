import type {
  CarPlayCondensedElement,
  CarPlayImageRowElement,
  CarPlayListItem,
  CarPlayListRow,
  CarPlayListSection,
  CarPlayListTemplate,
  CarPlayRoot,
} from 'react-native-nitro-player';

import { pickArtwork } from '../youtube/mappers/common';
import type { Album, AlbumPage, Artist, ArtistPage, MusicItem, Shelf, Track } from '../youtube/models';

/**
 * Pure data -> CarPlay template builders. No React, no native calls, so they are unit-tested with fixtures and
 * run unchanged on a CarPlay-only launch.
 *
 * Row ids are a tiny protocol handled in `index.ts`:
 *   track:<ctx>:<videoId>   play the context `ctx` starting at that track
 *   playctx:<ctx>           play the context from the start      shufflectx:<ctx>   same, shuffled
 *   open:<album|artist|playlist>:<id>   (loadTemplate rows)      resume / retry:<tab>
 * `ctx` is e.g. `recents`, `home:quick`, `home:3`, `album:<id>`, `playlist:<id>`, `artist:<id>`, `liked`.
 */

/** CarPlay limits: <= 8 tiles per image row (the library's cap), <= 100 list rows. */
export const MAX_TILES = 8;
export const MAX_ROWS = 100;

export const TAB_IDS = ['home', 'library', 'recents', 'downloads'] as const;
export type TabId = (typeof TAB_IDS)[number];

const art = (a: MusicItem['artwork'] | Track['artwork']): string => pickArtwork(a, 300) ?? 'music.note';
const artistLine = (t: Track) => t.artists.map((a) => a.name).join(', ');

export const ROOT_TEXTS: NonNullable<CarPlayRoot['texts']> = {
  loading: 'Loading…',
  loadFailed: "Couldn't load",
  retry: 'Tap to try again',
  emptyQueue: 'Nothing queued',
  emptyPlaylist: 'No tracks',
};

/** Tabs are lazy: they show instantly and `CarPlayHelper.setTemplateLoader` fills them from cache. */
export function buildRoot(): CarPlayRoot {
  const lazy = { lazy: true, loadingTitle: 'Loading…', errorTitle: "Couldn't load", errorSubtitle: 'Tap to try again' } as const;
  return {
    templates: [
      { type: 'list', id: 'home', title: 'Home', tab: { title: 'Home', image: 'house.fill' }, ...lazy },
      { type: 'list', id: 'library', title: 'Library', tab: { systemItem: 'favorites' }, ...lazy },
      { type: 'list', id: 'recents', title: 'Recents', tab: { systemItem: 'recents' }, ...lazy },
      { type: 'list', id: 'downloads', title: 'Downloads', tab: { systemItem: 'downloads' }, ...lazy },
    ],
    nowPlaying: { upNext: true, upNextTitle: 'Up Next', albumArtist: false },
    texts: ROOT_TEXTS,
    placeholders: { artwork: 'music.note', playlist: 'music.note.list' },
  };
}

// ---- elements ----

const trackItem = (t: Track, ctx: string): CarPlayListItem => ({
  id: `track:${ctx}:${t.id}`,
  title: t.title,
  subtitle: artistLine(t),
  image: art(t.artwork),
  trackId: t.id,
  explicit: t.explicit,
  accessory: 'none',
  playingIndicator: 'trailing',
});

/** What tapping a non-track music item does: collections open a lazy template, playlists play at once. */
function collectionAction(item: Exclude<MusicItem, Track>): { id: string; loadTemplate?: boolean } {
  if (item.kind === 'playlist') return { id: `playctx:playlist:${item.id}` };
  return { id: `open:${item.kind}:${item.id}`, loadTemplate: true };
}

function tile(item: MusicItem, ctx: string): CarPlayImageRowElement {
  if (item.kind === 'track') return { id: `track:${ctx}:${item.id}`, image: art(item.artwork), title: item.title, subtitle: artistLine(item) };
  const sub = item.kind === 'album' ? item.artists.map((a) => a.name).join(', ') : item.kind === 'artist' ? item.subtitle : item.author ?? item.subtitle;
  return { ...collectionAction(item), image: art(item.artwork), title: item.kind === 'artist' ? item.name : item.title, subtitle: sub };
}

function condensedTile(t: Track, ctx: string): CarPlayCondensedElement {
  return { id: `track:${ctx}:${t.id}`, image: art(t.artwork), title: t.title, subtitle: artistLine(t), accessorySymbol: 'play.fill' };
}

const empty = (id: string, title: string, subtitle?: string): CarPlayListItem => ({ id, title, subtitle, accessory: 'none', image: 'info.circle' });

// ---- Home ----

export type ResumeInfo = { track: Track; paused: boolean };

export type HomeData = {
  /** `undefined` while nothing is cached and the network has not answered (offline first launch). */
  shelves?: Shelf[];
  resume?: ResumeInfo;
  recents: Track[];
  recentAlbums: { id: string; name: string; artwork: Track['artwork'] }[];
  /** True when the fetch failed and there is no cached feed. */
  offline?: boolean;
  /** Last phone searches (newest first); tapping one plays its top song plus radio. */
  recentSearches?: string[];
};

export const MAX_RECENT_SEARCHES = 8;

const isQuickPicks = (s: Shelf) => /quick picks/i.test(s.title);

/** The Quick picks shelf (tracks only) and its context key. Shared with the select handler. */
export function quickPicks(shelves: Shelf[] | undefined): { tracks: Track[]; ctx: string } | undefined {
  if (!shelves) return;
  const i = shelves.findIndex((s) => isQuickPicks(s) && s.items.some((x) => x.kind === 'track'));
  const j = i >= 0 ? i : shelves.findIndex((s) => s.items.filter((x) => x.kind === 'track').length >= 3);
  if (j < 0) return;
  return { tracks: shelves[j].items.filter((x): x is Track => x.kind === 'track'), ctx: `home:${j}` };
}

export function buildHome(d: HomeData): CarPlayListTemplate {
  const sections: CarPlayListSection[] = [];

  if (d.resume) {
    const t = d.resume.track;
    sections.push({
      items: [
        {
          type: 'imageRow',
          id: 'continue',
          style: 'condensed',
          elements: [{ id: 'resume', image: art(t.artwork), title: t.title, subtitle: `${d.resume.paused ? 'Resume' : 'Now playing'} · ${artistLine(t)}`, accessorySymbol: d.resume.paused ? 'play.fill' : 'waveform' }],
        },
      ],
    });
  }

  const searches = (d.recentSearches ?? []).filter((q) => q.trim()).slice(0, MAX_RECENT_SEARCHES);
  if (searches.length) {
    sections.push({
      header: 'Recent searches',
      items: searches.map((q) => ({ id: `search:${q}`, title: q, subtitle: 'Plays the top song, then radio', accessory: 'none' as const, image: 'clock' })),
    });
  }

  const qp = quickPicks(d.shelves);
  if (qp) {
    sections.push({
      items: [{ type: 'imageRow', id: 'quick', style: 'condensed', title: 'Quick picks', elements: qp.tracks.slice(0, MAX_TILES).map((t) => condensedTile(t, qp.ctx)) }],
    });
  }

  d.shelves?.forEach((shelf, i) => {
    if (`home:${i}` === qp?.ctx || !shelf.items.length) return;
    sections.push({
      items: [{ type: 'imageRow', id: `shelf-${i}`, style: 'row', title: shelf.title || 'For you', elements: shelf.items.slice(0, MAX_TILES).map((it) => tile(it, `home:${i}`)) }],
    });
  });

  if (d.recentAlbums.length) {
    sections.push({
      items: [
        {
          type: 'imageRow',
          id: 'recent-albums',
          style: 'row',
          title: 'Recently played',
          elements: d.recentAlbums.slice(0, MAX_TILES).map((a) => ({ id: `open:album:${a.id}`, loadTemplate: true, image: art(a.artwork), title: a.name })),
        },
      ],
    });
  } else if (d.recents.length) {
    sections.push({
      items: [{ type: 'imageRow', id: 'recent-tracks', style: 'row', title: 'Recently played', elements: d.recents.slice(0, MAX_TILES).map((t) => tile(t, 'recents')) }],
    });
  }

  if (!sections.length) {
    sections.push({
      items: [
        d.offline
          ? empty('retry:home', "You're offline", 'Nothing cached yet. Tap to retry.')
          : empty('retry:home', 'Nothing here yet', 'Play something on your phone, then come back.'),
      ],
    });
  } else if (d.offline) {
    sections.unshift({ items: [empty('retry:home', "Offline — showing what's saved", 'Tap to retry')] });
  }

  // Audio apps cannot show a keyboard in CarPlay; search in the car is Siri. This row is only a hint, tapping it shuffles Liked.
  sections.unshift({ items: [{ id: 'siri:hint', title: 'Ask Siri: \u201CPlay \u2026 on Sangeet\u201D', subtitle: 'Tap to shuffle your Liked Songs', accessory: 'none', image: 'mic.fill' }] });

  return { type: 'list', id: 'home', title: 'Home', sections };
}

// ---- Library ----

export type LibraryData = { liked: Track[]; recentAlbums: HomeData['recentAlbums']; recentArtists: HomeData['recentAlbums']; playlists?: { id: string; name: string; artwork: Track['artwork']; subtitle?: string }[] };

export function buildLibrary(d: LibraryData): CarPlayListTemplate {
  const rows: CarPlayListRow[] = [
    d.liked.length
      ? { id: 'open:liked:all', title: 'Liked Songs', subtitle: `${d.liked.length} songs`, image: 'heart.fill', loadTemplate: true, accessory: 'disclosure' }
      : empty('liked-empty', 'Liked Songs', 'Like songs on your phone and they appear here'),
    { id: 'open:library:albums', title: 'Albums', subtitle: d.recentAlbums.length ? 'Recently played' : 'Nothing yet', image: 'square.stack.fill', loadTemplate: true, accessory: 'disclosure', enabled: d.recentAlbums.length > 0 },
    { id: 'open:library:artists', title: 'Artists', subtitle: d.recentArtists.length ? 'Recently played' : 'Nothing yet', image: 'music.mic', loadTemplate: true, accessory: 'disclosure', enabled: d.recentArtists.length > 0 },
    d.playlists?.length
      ? { id: 'open:library:playlists', title: 'Playlists', subtitle: `${d.playlists.length} saved`, image: 'music.note.list', loadTemplate: true, accessory: 'disclosure' }
      : empty('playlists-empty', 'Playlists', 'Save playlists on your phone and they appear here'),
  ];
  return { type: 'list', id: 'library', title: 'Library', sections: [{ items: rows }] };
}

export function buildLibraryAlbums(albums: LibraryData['recentAlbums']): CarPlayListTemplate {
  return {
    type: 'list',
    id: 'library-albums',
    title: 'Albums',
    sections: [{ items: albums.slice(0, MAX_ROWS).map((a) => ({ id: `open:album:${a.id}`, title: a.name, image: art(a.artwork), loadTemplate: true, accessory: 'disclosure' as const })) }],
    emptyTitle: 'No albums yet',
  };
}

export function buildLibraryPlaylists(playlists: NonNullable<LibraryData['playlists']>): CarPlayListTemplate {
  return {
    type: 'list',
    id: 'library-playlists',
    title: 'Playlists',
    sections: [{ items: playlists.slice(0, MAX_ROWS).map((p) => ({ id: `open:playlist:${p.id}`, title: p.name, subtitle: p.subtitle, image: art(p.artwork), loadTemplate: true, accessory: 'disclosure' as const })) }],
    emptyTitle: 'No playlists yet',
  };
}

export function buildLibraryArtists(artists: LibraryData['recentArtists']): CarPlayListTemplate {
  return {
    type: 'list',
    id: 'library-artists',
    title: 'Artists',
    sections: [{ items: artists.slice(0, MAX_ROWS).map((a) => ({ id: `open:artist:${a.id}`, title: a.name, image: art(a.artwork), loadTemplate: true, accessory: 'disclosure' as const })) }],
    emptyTitle: 'No artists yet',
  };
}

// ---- Recents / Downloads ----

export function buildRecents(tracks: Track[]): CarPlayListTemplate {
  return {
    type: 'list',
    id: 'recents',
    title: 'Recents',
    sections: [{ items: tracks.slice(0, MAX_ROWS).map((t) => trackItem(t, 'recents')) }],
    emptyTitle: 'Nothing played yet',
    emptySubtitle: 'Songs you play show up here',
  };
}

export type DownloadsData = { tracks: Track[]; groups: { kind: string; id: string; name: string; count: number; artwork: Track['artwork'] }[] };

/** Downloaded songs (shuffle-all row first) and downloaded albums/playlists grouped. */
export function buildDownloads(d?: DownloadsData): CarPlayListTemplate {
  if (!d?.tracks.length) return { type: 'list', id: 'downloads', title: 'Downloads', sections: [{ items: [empty('downloads-empty', 'No downloads yet')] }] };
  const groupRows: CarPlayListItem[] = d.groups.slice(0, 20).map((g) => ({ id: `open:dgroup:${g.kind}:${g.id}`, title: g.name, subtitle: `${g.kind === 'album' ? 'Album' : 'Playlist'} · ${g.count} songs`, image: art(g.artwork), loadTemplate: true, accessory: 'disclosure' as const }));
  return {
    type: 'list',
    id: 'downloads',
    title: 'Downloads',
    sections: [
      { items: [{ id: 'shufflectx:downloads', title: 'Shuffle all', image: 'shuffle', accessory: 'none' }] },
      ...(groupRows.length ? [{ header: 'Albums and playlists', items: groupRows }] : []),
      { header: 'Songs', items: d.tracks.slice(0, MAX_ROWS - 24).map((t) => trackItem(t, 'downloads')) },
    ],
  };
}

// ---- Lazy detail templates ----

const actionRows = (ctx: string): CarPlayListItem[] => [
  { id: `playctx:${ctx}`, title: 'Play', image: 'play.fill', accessory: 'none' },
  { id: `shufflectx:${ctx}`, title: 'Shuffle', image: 'shuffle', accessory: 'none' },
];

function trackList(id: string, title: string, ctx: string, tracks: Track[], extra: CarPlayListSection[] = []): CarPlayListTemplate {
  return {
    type: 'list',
    id,
    title,
    sections: [{ items: actionRows(ctx) }, { items: tracks.slice(0, MAX_ROWS - 2).map((t) => trackItem(t, ctx)) }, ...extra],
    emptyTitle: 'No tracks',
  };
}

export const buildAlbum = (p: AlbumPage): CarPlayListTemplate => trackList(`album:${p.album.id}`, p.album.title, `album:${p.album.id}`, p.tracks);

export const buildPlaylist = (id: string, title: string, tracks: Track[]): CarPlayListTemplate => trackList(`playlist:${id}`, title, `playlist:${id}`, tracks);

export const buildLiked = (tracks: Track[]): CarPlayListTemplate => trackList('liked', 'Liked Songs', 'liked', tracks);

const albumRow = (a: Album): CarPlayListItem => ({ id: `open:album:${a.id}`, title: a.title, subtitle: [a.releaseType, a.year].filter(Boolean).join(' · '), image: art(a.artwork), loadTemplate: true, accessory: 'disclosure' });

export function buildArtist(p: ArtistPage): CarPlayListTemplate {
  const ctx = `artist:${p.artist.id}`;
  const albums = [...p.albums, ...p.singles].slice(0, 20).map(albumRow);
  return {
    type: 'list',
    id: ctx,
    title: p.artist.name,
    sections: [
      { items: actionRows(ctx) },
      { header: 'Top songs', items: p.topSongs.slice(0, 10).map((t) => trackItem(t, ctx)) },
      ...(albums.length ? [{ header: 'Albums', items: albums }] : []),
    ],
  };
}

/** Fallback detail screen when a lazy fetch fails and nothing is cached. */
export const buildOffline = (id: string, title: string): CarPlayListTemplate => ({
  type: 'list',
  id,
  title,
  sections: [{ items: [empty(`retry:${id}`, "You're offline", 'This is not cached. Tap to retry.')] }],
});

// ---- id parsing ----

export type RowAction =
  | { kind: 'track'; ctx: string; videoId: string }
  | { kind: 'playctx'; ctx: string; shuffle: boolean }
  | { kind: 'resume' }
  | { kind: 'siri' }
  | { kind: 'recentSearch'; query: string }
  | { kind: 'retry'; target: string }
  | { kind: 'unknown' };

export function parseRowId(id: string): RowAction {
  if (id === 'resume') return { kind: 'resume' };
  if (id === 'siri:hint') return { kind: 'siri' };
  if (id.startsWith('search:')) return { kind: 'recentSearch', query: id.slice(7) };
  if (id.startsWith('retry:')) return { kind: 'retry', target: id.slice(6) };
  if (id.startsWith('playctx:')) return { kind: 'playctx', ctx: id.slice(8), shuffle: false };
  if (id.startsWith('shufflectx:')) return { kind: 'playctx', ctx: id.slice(11), shuffle: true };
  if (id.startsWith('track:')) {
    const rest = id.slice(6);
    const cut = rest.lastIndexOf(':');
    if (cut > 0) return { kind: 'track', ctx: rest.slice(0, cut), videoId: rest.slice(cut + 1) };
  }
  return { kind: 'unknown' };
}

/** `open:<what>:<id>` loader ids. */
export function parseOpenId(id: string): { what: string; id: string } | undefined {
  const m = /^open:([a-z]+):(.+)$/.exec(id);
  return m ? { what: m[1], id: m[2] } : undefined;
}

export type { Artist };
