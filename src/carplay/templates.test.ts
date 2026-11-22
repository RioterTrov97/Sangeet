import type { Album, AlbumPage, ArtistPage, Playlist, Shelf, Track } from '../youtube/models';
import {
  MAX_ROWS,
  MAX_TILES,
  buildAlbum,
  buildArtist,
  buildDownloads,
  buildHome,
  buildLibrary,
  buildOffline,
  buildRecents,
  buildRoot,
  parseOpenId,
  parseRowId,
  quickPicks,
} from './templates';

const art = [{ url: 'https://x/y=w60-h60', width: 60, height: 60 }];
const t = (id: string): Track => ({ kind: 'track', id, title: `T ${id}`, artists: [{ id: 'A1', name: 'Artist' }], artwork: art, album: { id: 'AL1', name: 'Alb' } });
const tracks = (n: number) => Array.from({ length: n }, (_, i) => t(`t${i}`));
const album = (id: string): Album => ({ kind: 'album', id, title: `Album ${id}`, artists: [{ name: 'Artist' }], artwork: art, year: '2020' });
const pl = (id: string): Playlist => ({ kind: 'playlist', id, title: `PL ${id}`, artwork: art });

const shelves: Shelf[] = [
  { title: 'Listen again', items: [album('a1'), pl('p1'), t('x')] },
  { title: 'Quick picks', items: tracks(20) },
  { title: 'Mixed for you', items: [pl('p2'), pl('p3')] },
];

const rows = (tpl: { sections?: { items: unknown[] }[] }) => tpl.sections!.flatMap((s) => s.items) as any[];

describe('buildDownloads with data', () => {
  const tr = (id: string): Track => ({ kind: 'track', id, title: id, artists: [], artwork: [] });
  it('lists shuffle-all, groups and songs', () => {
    const tpl: any = buildDownloads({ tracks: [tr('a'), tr('b')], groups: [{ kind: 'album', id: 'al', name: 'Al', count: 2, artwork: [] }] });
    const ids = tpl.sections.flatMap((s: any) => s.items.map((i: any) => i.id));
    expect(ids[0]).toBe('shufflectx:downloads');
    expect(ids).toContain('open:dgroup:album:al');
    expect(ids).toContain('track:downloads:a');
  });
});

describe('buildRoot', () => {
  it('has at most 4 lazy tabs with the specified system items', () => {
    const r = buildRoot();
    expect(r.templates.length).toBeLessThanOrEqual(4);
    expect(r.templates.map((x) => x.id)).toEqual(['home', 'library', 'recents', 'downloads']);
    expect(r.templates.every((x) => x.type === 'list' && x.lazy)).toBe(true);
    expect(r.templates.map((x) => (x as any).tab.systemItem)).toEqual([undefined, 'favorites', 'recents', 'downloads']);
    expect(r.nowPlaying).toMatchObject({ upNext: true });
  });
});

const content = (tpl: ReturnType<typeof buildHome>) => rows(tpl).filter((r) => r.id !== 'siri:hint');

describe('buildHome', () => {
  it('starts with the Ask Siri hint row, and adds Recent searches (max 8) that map back to a query', () => {
    const tpl = buildHome({ shelves, recents: [], recentAlbums: [], recentSearches: Array.from({ length: 12 }, (_, i) => `q${i}`) });
    expect(rows(tpl)[0]).toMatchObject({ id: 'siri:hint', title: expect.stringContaining('Ask Siri') });
    const sec = (tpl.sections as any[]).find((x) => x.header === 'Recent searches');
    expect(sec.items).toHaveLength(8);
    expect(parseRowId(sec.items[0].id)).toEqual({ kind: 'recentSearch', query: 'q0' });
    expect(parseRowId('siri:hint')).toEqual({ kind: 'siri' });
  });

  it('orders Continue, Quick picks, shelves, Recently played and respects the 8-tile cap', () => {
    const tpl = buildHome({ shelves, resume: { track: t('r'), paused: true }, recents: tracks(5), recentAlbums: [{ id: 'AL1', name: 'Alb', artwork: art }] });
    const ids = content(tpl).map((r) => r.id);
    expect(ids).toEqual(['continue', 'quick', 'shelf-0', 'shelf-2', 'recent-albums']);
    const quick = content(tpl).find((r) => r.id === 'quick');
    expect(quick.style).toBe('condensed');
    expect(quick.elements).toHaveLength(MAX_TILES);
    expect(quick.elements[0].id).toBe('track:home:1:t0');
    expect(content(tpl)[0].elements[0]).toMatchObject({ id: 'resume', accessorySymbol: 'play.fill' });
  });

  it('maps tiles: albums open lazily, playlists play at once, tracks play in context', () => {
    const tpl = buildHome({ shelves, recents: [], recentAlbums: [] });
    const el = content(tpl).find((r) => r.id === 'shelf-0').elements;
    expect(el[0]).toMatchObject({ id: 'open:album:a1', loadTemplate: true });
    expect(el[1]).toMatchObject({ id: 'playctx:playlist:p1' });
    expect(el[1].loadTemplate).toBeUndefined();
    expect(el[2].id).toBe('track:home:0:x');
  });

  it('shows an offline retry row when nothing is cached', () => {
    const tpl = buildHome({ recents: [], recentAlbums: [], offline: true });
    expect(content(tpl)).toHaveLength(1);
    expect(content(tpl)[0]).toMatchObject({ id: 'retry:home', title: "You're offline" });
  });

  it('keeps cached content and flags offline on top', () => {
    const tpl = buildHome({ shelves, recents: [], recentAlbums: [], offline: true });
    expect(content(tpl)[0].title).toMatch(/Offline/);
    expect(content(tpl).length).toBeGreaterThan(2);
  });

  it('never emits an empty image row and falls back to recent tracks without albums', () => {
    const tpl = buildHome({ shelves: [{ title: 'Empty', items: [] }], recents: tracks(3), recentAlbums: [] });
    expect(content(tpl).map((r) => r.id)).toEqual(['recent-tracks']);
  });
});

describe('quickPicks', () => {
  it('finds the Quick picks shelf, else the first track-heavy shelf', () => {
    expect(quickPicks(shelves)?.ctx).toBe('home:1');
    expect(quickPicks([{ title: 'Mix', items: tracks(4) }])?.ctx).toBe('home:0');
    expect(quickPicks([{ title: 'Albums', items: [album('a')] }])).toBeUndefined();
  });
});

describe('lists', () => {
  it('Recents caps at 100 rows and tags the context', () => {
    const tpl = buildRecents(tracks(150));
    expect(rows(tpl)).toHaveLength(MAX_ROWS);
    expect(rows(tpl)[0]).toMatchObject({ id: 'track:recents:t0', trackId: 't0' });
  });

  it('Downloads is a placeholder', () => {
    expect(rows(buildDownloads())[0].title).toBe('No downloads yet');
  });

  it('Library offers albums/artists derived from history and disables them when empty', () => {
    const empty = rows(buildLibrary({ liked: [], recentAlbums: [], recentArtists: [] }));
    expect(empty.find((r) => r.id === 'open:library:albums').enabled).toBe(false);
    const full = rows(buildLibrary({ liked: tracks(2), recentAlbums: [{ id: 'a', name: 'A', artwork: art }], recentArtists: [{ id: 'b', name: 'B', artwork: art }] }));
    expect(full[0]).toMatchObject({ id: 'open:liked:all', loadTemplate: true });
    expect(full.find((r) => r.id === 'open:library:albums').enabled).toBe(true);
  });

  it('Album template has Play/Shuffle rows then tracks', () => {
    const page: AlbumPage = { album: album('a1'), tracks: tracks(3) };
    const r = rows(buildAlbum(page));
    expect(r.map((x) => x.id)).toEqual(['playctx:album:a1', 'shufflectx:album:a1', 'track:album:a1:t0', 'track:album:a1:t1', 'track:album:a1:t2']);
  });

  it('Artist template has top songs and album rows that open lazily', () => {
    const page: ArtistPage = { artist: { kind: 'artist', id: 'ar', name: 'Ar', artwork: art }, topSongs: tracks(2), albums: [album('a1')], singles: [], related: [], shelves: [] };
    const tpl = buildArtist(page);
    expect(tpl.sections!.map((s) => s.header)).toEqual([undefined, 'Top songs', 'Albums']);
    expect(rows(tpl).find((r) => r.id === 'open:album:a1').loadTemplate).toBe(true);
  });

  it('offline detail fallback has a retry row', () => {
    expect(rows(buildOffline('album:x', 'Album'))[0].id).toBe('retry:album:x');
  });
});

describe('row id protocol', () => {
  it('parses ids, including contexts with colons', () => {
    expect(parseRowId('track:album:MPREb_x:abc-_123')).toEqual({ kind: 'track', ctx: 'album:MPREb_x', videoId: 'abc-_123' });
    expect(parseRowId('playctx:playlist:PL1')).toEqual({ kind: 'playctx', ctx: 'playlist:PL1', shuffle: false });
    expect(parseRowId('shufflectx:liked')).toEqual({ kind: 'playctx', ctx: 'liked', shuffle: true });
    expect(parseRowId('retry:home')).toEqual({ kind: 'retry', target: 'home' });
    expect(parseRowId('resume')).toEqual({ kind: 'resume' });
    expect(parseRowId('zzz')).toEqual({ kind: 'unknown' });
    expect(parseOpenId('open:album:MPREb_x')).toEqual({ what: 'album', id: 'MPREb_x' });
    expect(parseOpenId('home')).toBeUndefined();
  });
});
