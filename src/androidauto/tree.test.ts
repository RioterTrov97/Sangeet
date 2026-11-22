import type { Album, Artist, Playlist, Shelf, Track } from '../youtube/models';
import {
  buildRoot,
  downloadsNodes,
  homeNodes,
  libraryListNodes,
  libraryNodes,
  MAX_ITEMS,
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_COLLECTIONS,
  MAX_SEARCH_SONGS,
  parseOpen,
  parseSearch,
  recentSearchNodes,
  searchItems,
  shelfNodes,
  songItems,
  toItems,
  type LibraryData,
} from './tree';

const t = (id: string, title = id): Track => ({ kind: 'track', id, title, artists: [{ name: 'A' }, { name: 'B' }], artwork: [{ url: `https://img/${id}=w120-h120` }] });
const album = (id: string): Album => ({ kind: 'album', id, title: `Album ${id}`, artists: [{ name: 'Art' }], artwork: [] });
const playlist = (id: string): Playlist => ({ kind: 'playlist', id, title: `PL ${id}`, author: 'Me', artwork: [] });
const shelves: Shelf[] = [
  { title: 'Quick picks', items: [t('a'), t('b'), t('c'), t('d')] },
  { title: 'Albums for you', items: [album('MPREb_1'), album('MPREb_2')] },
  { title: 'Mixed', items: [t('x'), playlist('PL1')] },
];
const lib: LibraryData = { liked: [t('l1')], playlists: [{ id: 'local:1', name: 'Gym', artwork: [] }], albums: [{ id: 'MPREb_9', name: 'Nine', artwork: [] }], artists: [] };

describe('Android Auto browse tree', () => {
  it('has the four CarPlay tabs as lazy folders', () => {
    const root = buildRoot();
    expect(root.map((r) => r.title)).toEqual(['Home', 'Library', 'Recents', 'Downloads']);
    expect(root.every((r) => r.mediaType === 'folder' && !r.isPlayable && r.children?.length === 0)).toBe(true);
  });

  it('builds Home: continue, recents, quick picks as a song list, album shelves as folders', () => {
    const nodes = homeNodes({ shelves, resume: t('r'), recents: [t('h1'), t('h2')] });
    expect(nodes.map((n) => (n.kind === 'songs' ? `songs:${n.ctx}` : n.id))).toEqual(['songs:continue', 'songs:recents', 'songs:home:0', 'shelf:1', 'shelf:2']);
    expect(shelfNodes(shelves, 1).map((n) => (n.kind === 'folder' ? n.id : ''))).toEqual(['open:album:MPREb_1', 'open:album:MPREb_2']);
    expect(shelfNodes(shelves, 2).map((n) => (n.kind === 'folder' ? n.id : ''))).toEqual(['open:playlist:PL1']);
    expect(shelfNodes(undefined, 0)).toEqual([]);
  });

  it('builds Library and its lists, skipping empty ones', () => {
    expect(libraryNodes(lib).map((n) => (n.kind === 'songs' ? n.ctx : n.id))).toEqual(['liked', 'lib:playlists', 'lib:albums']);
    expect(libraryListNodes('playlists', lib).map((n) => (n.kind === 'folder' ? n.id : ''))).toEqual(['open:playlist:local:1']);
    expect(libraryListNodes('nope', lib)).toEqual([]);
  });

  it('builds Downloads, empty when there are none', () => {
    expect(downloadsNodes({ tracks: [], groups: [] })).toEqual([]);
    const n = downloadsNodes({ tracks: [t('d1')], groups: [{ kind: 'album', id: 'MPREb_3', name: 'Three', count: 4, artwork: [] }] });
    expect(n.map((x) => (x.kind === 'songs' ? x.ctx : x.id))).toEqual(['downloads', 'dgroup:album:MPREb_3']);
  });

  it('turns nodes into car items: playlists reference a native playlist, folders load lazily', () => {
    const items = toItems(homeNodes({ shelves, recents: [] }), (ctx) => `pl-${ctx}`);
    expect(items[0]).toMatchObject({ id: 'list:home:0', mediaType: 'playlist', playlistId: 'pl-home:0', isPlayable: false });
    expect(items[1]).toMatchObject({ id: 'shelf:1', mediaType: 'folder', children: [] });
    expect(toItems(homeNodes({ shelves, recents: [] }), () => undefined).map((i) => i.id)).toEqual(['shelf:1', 'shelf:2']);
  });

  it('lists songs as playable rows of the playlist, capped', () => {
    const rows = songItems('PL', [t('s1', 'One')]);
    expect(rows[0]).toEqual({ id: 'PL:s1', title: 'One', subtitle: 'A, B', iconUrl: expect.stringContaining('https://img/s1'), isPlayable: true, mediaType: 'audio' });
    expect(songItems('PL', Array.from({ length: 250 }, (_, i) => t(`s${i}`)))).toHaveLength(MAX_ITEMS);
  });

  it('parses open ids that contain colons', () => {
    expect(parseOpen('open:playlist:local:12')).toEqual({ what: 'playlist', id: 'local:12' });
    expect(parseOpen('open:album:MPREb_x')).toEqual({ what: 'album', id: 'MPREb_x' });
    expect(parseOpen('home')).toBeUndefined();
  });

  describe('search', () => {
    const artist = (id: string): Artist => ({ kind: 'artist', id, name: `Artist ${id}`, artwork: [] });

    it('adds a Recent searches folder to Home only when there are searches', () => {
      const ids = (searches?: string[]) => homeNodes({ recents: [t('h1')], searches }).map((n) => (n.kind === 'songs' ? `songs:${n.ctx}` : n.id));
      expect(ids(['coldplay'])).toEqual(['songs:recents', 'searches']);
      expect(ids([])).toEqual(['songs:recents']);
      expect(ids(['  '])).toEqual(['songs:recents']);
    });

    it('lists recent searches newest first, trimmed, capped, each opening its results', () => {
      const nodes = recentSearchNodes([' eminem ', '', ...Array.from({ length: 12 }, (_, i) => `q${i}`)]);
      expect(nodes).toHaveLength(MAX_RECENT_SEARCHES);
      expect(nodes[0]).toMatchObject({ kind: 'folder', id: 'search:eminem', title: 'eminem' });
      expect(parseSearch(nodes[0].kind === 'folder' ? nodes[0].id : '')).toBe('eminem');
      expect(parseSearch('search:')).toBeUndefined();
      expect(parseSearch('open:album:x')).toBeUndefined();
    });

    it('puts playable songs first, then a few albums and artists as folders (no playlists)', () => {
      const tracks = Array.from({ length: 30 }, (_, i) => t(`s${i}`));
      const cols = [album('MPREb_1'), playlist('PL1'), artist('UC1'), ...Array.from({ length: 10 }, (_, i) => album(`MPREb_x${i}`))];
      const items = searchItems('pl7', tracks, cols);
      const songs = items.filter((i) => i.isPlayable);
      expect(songs).toHaveLength(MAX_SEARCH_SONGS);
      expect(songs[0]).toMatchObject({ id: 'pl7:s0', mediaType: 'audio' });
      const folders = items.filter((i) => !i.isPlayable);
      expect(folders).toHaveLength(MAX_SEARCH_COLLECTIONS);
      expect(folders.map((f) => f.id).slice(0, 2)).toEqual(['open:album:MPREb_1', 'open:artist:UC1']);
      expect(items.indexOf(folders[0])).toBe(MAX_SEARCH_SONGS);
    });

    it('returns only folders when no song matched', () => {
      expect(searchItems(undefined, [], [artist('UC1')]).map((i) => i.id)).toEqual(['open:artist:UC1']);
    });
  });
});
