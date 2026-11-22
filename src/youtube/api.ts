import { Platform } from 'react-native';

import { preferOfficial } from './official';
import { localeSessionOptions, onContentLocaleChange } from './contentLocale';
import { createLimiter, type Priority } from './limiter';
import 'event-target-polyfill';
import 'react-native-url-polyfill/auto';
import { Innertube, Parser, YTNodes } from 'youtubei.js/react-native';

import { log, timed } from '../util/log';
import { queryClient } from './queryClient';
import type { Album, AlbumPage, Artist, ArtistPage, Playlist, MusicItem, Page, PlaylistPage, SearchType, Shelf, Track, ArtistRef } from './models';
import type { VideoCandidate } from '../video/match';
import {
  mapAlbumPage,
  mapArtistPage,
  mapHome,
  mapPlaylistHeader,
  mapPlaylistTracks,
  mapSearchAll,
  mapSearchItems,
  mapSuggestions,
  mapUpNext,
} from './mappers/pages';
import { mapItems } from './mappers/items';

/**
 * Single reused InnerTube session. youtubei.js runs in Hermes for the Music data endpoints only
 * (no player/decipher here: stream URLs come from the WebView extractor).
 */
let sessionPromise: Promise<Innertube> | undefined;
let authCookie: string | undefined;
let onAuthError: (() => void) | undefined;

/**
 * Switches the data session between anonymous and signed in (youtubei.js computes the SAPISIDHASH header from the
 * cookie). The stream extractor WebView stays anonymous regardless. Never log `cookie`.
 */
export function setAuthCookie(cookie: string | undefined): void {
  authCookie = cookie;
  sessionPromise = undefined;
}
export const hasAuthCookieSet = () => !!authCookie;
/** Called when an authed request comes back 401/403 (the auth module then drops to anonymous mode). */
export function setAuthErrorHandler(fn: (() => void) | undefined): void {
  onAuthError = fn;
}

export function getSession(): Promise<Innertube> {
  sessionPromise ??= Innertube.create({ retrieve_player: false, generate_session_locally: true, ...localeSessionOptions(), ...(authCookie ? { cookie: authCookie } : {}) }).catch((e) => {
    sessionPromise = undefined;
    throw e;
  });
  return sessionPromise;
}

/** Test hook: lets tests inject an Innertube wired to recorded fixtures. */
export function setSessionForTests(yt: Innertube | undefined): void {
  sessionPromise = yt ? Promise.resolve(yt) : undefined;
}

/** TV only: at most 2 YouTube API calls at once (a slow CPU parsing many parallel responses stalls the UI); the phone is not limited. */
const limiter = createLimiter(Platform.isTV ? 2 : Infinity);
/** Runs Now-Playing work (up-next, counterpart, lyrics) at once, ahead of the queued browsing calls. */
export const apiHigh = <T>(fn: () => Promise<T>): Promise<T> => limiter.limit(fn, 'high');
export const apiStats = () => limiter.stats();

const q = <T>(name: string, fn: () => Promise<T>, priority: Priority = 'normal') =>
  limiter.limit(
    () =>
      timed('api', name, fn).catch((e) => {
        if (authCookie && /status code (401|403)\b/.test(e instanceof Error ? e.message : String(e))) onAuthError?.();
        throw e;
      }),
    priority,
  );

export async function searchAll(query: string): Promise<Shelf[]> {
  return q(`searchAll "${query}"`, async () => mapSearchAll(await (await getSession()).music.search(query)).map((sh) => ({ ...sh, items: preferOfficial(sh.items) })));
}

/** Filtered search with continuation. */
export async function search(query: string, type: SearchType): Promise<Page<MusicItem>> {
  return q(`search ${type} "${query}"`, async () => {
    const yt = await getSession();
    const res = await yt.music.search(query, { type });
    const shelf = res.contents?.[0];
    const pageOf = (items: MusicItem[], hasMore: boolean, c: any): Page<MusicItem> => ({
      items,
      next: hasMore
        ? async () => {
            const n = await c.getContinuation();
            return pageOf(preferOfficial(mapSearchItems(n.contents)), n.has_continuation, n);
          }
        : undefined,
    });
    return pageOf(preferOfficial(mapSearchItems(shelf ? [shelf] : [])), res.has_continuation, res);
  });
}

export async function getAlbum(id: string): Promise<AlbumPage> {
  return q(`getAlbum ${id}`, async () => mapAlbumPage(await (await getSession()).music.getAlbum(id), id));
}

export async function getArtist(id: string): Promise<ArtistPage> {
  return q(`getArtist ${id}`, async () => mapArtistPage(await (await getSession()).music.getArtist(id), id));
}

export async function getPlaylist(id: string): Promise<PlaylistPage> {
  return q(`getPlaylist ${id}`, async () => {
    const pl = await (await getSession()).music.getPlaylist(id);
    const pageOf = (p: any): Page<Track> => ({
      items: mapPlaylistTracks(p.items),
      next: p.has_continuation ? async () => pageOf(await p.getContinuation()) : undefined,
    });
    return { ...mapPlaylistHeader(pl, id), tracks: pageOf(pl) };
  });
}

/** Radio / "automix" queue for a video. The first item is the seed track itself. */
export async function getUpNext(videoId: string): Promise<Track[]> {
  return q(`getUpNext ${videoId}`, async () => mapUpNext(await (await getSession()).music.getUpNext(videoId)), 'high');
}

function findKey(node: any, key: string, depth = 0): any {
  if (!node || typeof node !== 'object' || depth > 14) return undefined;
  if (key in node) return node[key];
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const r = findKey(v, key, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/**
 * The video (OMV/ATV) counterpart of a song, via the watch-next panel's wrapper item. Returns the id to play as
 * video, `null` when none exists. Tracks that are videos themselves are their own counterpart.
 */
export async function getVideoCounterpart(videoId: string): Promise<string | null> {
  // `/next` answers anonymously with no counterpart; skip the two wasted requests.
  if (!hasAuthCookieSet()) return null;
  return q(`getVideoCounterpart ${videoId}`, async () => {
    const yt: any = await getSession();
    // The parsed up-next panel drops the wrapper's `counterpart`, so read the raw /next response (radio form first,
    // then the plain watch-next form), and finally the parsed `getInfo` page. The caller falls back to a search.
    for (const extra of [{ playlistId: `RDAMVM${videoId}`, isAudioOnly: true }, {}]) {
      try {
        const res: any = await yt.actions.execute('/next', { videoId, ...extra, client: 'YTMUSIC' });
        const wrapper = findKey(res.data, 'playlistPanelVideoWrapperRenderer');
        const alt = wrapper?.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer?.videoId as string | undefined;
        if (alt && alt !== videoId) return alt;
      } catch (e) {
        log('api', `counterpart /next failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    try {
      const info: any = await yt.music.getInfo(videoId);
      const counterpart = findKey(info?.page, 'counterpart');
      const alt = (Array.isArray(counterpart) ? counterpart[0]?.video_id : undefined) as string | undefined;
      if (alt && alt !== videoId) return alt;
    } catch (e) {
      log('api', `counterpart getInfo failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
  }, 'high');
}

/** YouTube Music "Videos" search rows exactly as returned (no `preferOfficial`: the matcher ranks uploads itself). */
export async function searchYtmVideos(query: string): Promise<Track[]> {
  return q(`searchYtmVideos "${query}"`, async () => {
    const res = await (await getSession()).music.search(query, { type: 'video' });
    const shelf = res.contents?.[0];
    return mapSearchItems(shelf ? [shelf] : []).filter((i): i is Track => i.kind === 'track');
  }, 'high');
}

/** Plain YouTube (WEB client) video search as video candidates: no YouTube Music label, but it finds videos Music's search lacks. */
export async function searchWebVideos(query: string): Promise<VideoCandidate[]> {
  return q(`searchWebVideos "${query}"`, async () => {
    const yt: any = await getSession();
    const res = await yt.search(query, { type: 'video' });
    const out: VideoCandidate[] = [];
    for (const v of res?.results ?? []) {
      const id = v?.video_id ?? v?.id;
      if (!id || typeof id !== 'string') continue;
      const digits = String(v.view_count?.text ?? v.short_view_count?.text ?? '').replace(/\D/g, '');
      const secs = v.duration?.seconds;
      out.push({
        id,
        title: String(v.title?.text ?? v.title ?? ''),
        channel: v.author?.name ? { id: v.author.id, name: String(v.author.name), ...(v.author.is_verified ? { verified: true } : {}) } : undefined,
        durationSec: typeof secs === 'number' && secs > 0 ? secs : undefined,
        views: digits ? Number(digits) : undefined,
        source: 'web',
      });
    }
    return out;
  });
}

export type VideoMeta = { videoType: NonNullable<VideoCandidate['videoType']>; artists: ArtistRef[] };
const metaCache = new Map<string, VideoMeta | null>();
/**
 * What YouTube Music knows about a video, through the up-next (`/next`) panel: its type (`song` = audio-only, `official`, `ugc`,
 * `plain` = no label, an ordinary upload) and artist list. Null when the panel does not start with this video. Memoized per session.
 */
export async function getVideoMeta(id: string): Promise<VideoMeta | null> {
  const hit = metaCache.get(id);
  if (hit !== undefined) return hit;
  const first = (await getUpNext(id))[0];
  const meta: VideoMeta | null = first && first.id === id ? { videoType: first.videoType ?? 'plain', artists: first.artists } : null;
  metaCache.set(id, meta);
  return meta;
}

export async function getSearchSuggestions(input: string): Promise<string[]> {
  return mapSuggestions(await (await getSession()).music.getSearchSuggestions(input));
}

/** The most recent first-page feed, so continuation pages carry on from it. */
let homeFeed: any;

export async function getHome(): Promise<Shelf[]> {
  return q('getHome', async () => {
    const feed = await (await getSession()).music.getHomeFeed();
    homeFeed = feed;
    return mapHome(feed);
  });
}

/**
 * Pages the Home feed continuation as `Page<Shelf>` (each page's items are whole shelves). The first call continues from
 * the last `getHome()` feed (fetching it when there is none). Anonymous sessions can get an empty continuation: that
 * throws, and the caller hides "more" and logs once.
 */
export function homeMorePage(feed?: any): Promise<Page<Shelf>> {
  // An anonymous session's continuation comes back empty every time: ask once per session, then answer without a request.
  if (homeMoreEmpty) return Promise.resolve({ items: [] });
  return q('getHome more', async () => {
    const f = feed ?? homeFeed ?? (homeFeed = await (await getSession()).music.getHomeFeed());
    if (!f.has_continuation) return { items: [] };
    const pageOf = (c: any): Page<Shelf> => ({ items: mapHome(c), next: c.has_continuation ? () => homeMorePage(c) : undefined });
    try {
      return pageOf(await f.getContinuation());
    } catch (e) {
      if (/did not have any content/i.test(e instanceof Error ? e.message : String(e))) {
        homeMoreEmpty = true;
        log('api', 'Home continuation has no content for this session; not asking again');
        return { items: [] };
      }
      throw e;
    }
  });
}
let homeMoreEmpty = false;

export type Explore = {
  topSongs: Track[];
  /** The "New albums & singles" carousel as is. */
  newReleases: MusicItem[];
  /** The carousel split by release type: albums / (singles + EPs). */
  newAlbums: Album[];
  newSingles: Album[];
  videos: Track[];
};

/** "en-AU" / "en_AU" -> "AU"; undefined when the locale carries no region. */
export function regionFromLocale(locale: string | undefined): string | undefined {
  const m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale ?? '');
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * Splits the YT Music Explore page into its chart-like carousels by item shape (robust to localised headers):
 * Trending = ranked song/video list items, new releases = album cards, new music videos = video cards.
 */
export function parseExplore(data: any): Explore {
  const parsed: any = Parser.parseResponse(data);
  const out: Explore = { topSongs: [], newReleases: [], newAlbums: [], newSingles: [], videos: [] };
  for (const sh of parsed.contents_memo?.getType(YTNodes.MusicCarouselShelf) ?? []) {
    const items = mapItems(sh.contents);
    if (!items.length) continue;
    const first = sh.contents?.[0];
    if (items.every((i) => i.kind === 'track')) {
      if (first?.type === 'MusicResponsiveListItem' && !out.topSongs.length) out.topSongs = items as Track[];
      else if (first?.type === 'MusicTwoRowItem' && !out.videos.length) out.videos = items as Track[];
    } else if (items.every((i) => i.kind === 'album') && !out.newReleases.length) out.newReleases = items;
  }
  const releases = out.newReleases as Album[];
  out.newSingles = releases.filter((a) => a.releaseType === 'Single' || a.releaseType === 'EP');
  out.newAlbums = releases.filter((a) => !out.newSingles.includes(a));
  return out;
}

const regionSessions = new Map<string, Promise<Innertube>>();

// A new content language / region applies to every request from the next one: all sessions are rebuilt, and the data cached for the old setting goes.
onContentLocaleChange(() => {
  sessionPromise = undefined;
  regionSessions.clear();
  homeFeed = undefined;
  void queryClient.resetQueries({ queryKey: ['yt'] });
});

async function sessionFor(region?: string): Promise<Innertube> {
  if (!region) return getSession();
  let p = regionSessions.get(region);
  if (!p) {
    p = Innertube.create({ retrieve_player: false, generate_session_locally: true, ...localeSessionOptions(), location: region });
    p.catch(() => regionSessions.delete(region));
    regionSessions.set(region, p);
  }
  return p;
}

export type Charts = { artists: Artist[]; playlists: Playlist[] };

/** Splits the YT Music Charts page by item shape (robust to localised headers): artist carousel -> top artists, playlist carousel -> chart playlists. */
export function parseCharts(data: any): Charts {
  const parsed: any = Parser.parseResponse(data);
  const out: Charts = { artists: [], playlists: [] };
  for (const sh of parsed.contents_memo?.getType(YTNodes.MusicCarouselShelf) ?? []) {
    const items = mapItems(sh.contents);
    if (!items.length) continue;
    if (items.every((i) => i.kind === 'artist') && !out.artists.length) out.artists = items as Artist[];
    else if (items.every((i) => i.kind === 'playlist') && !out.playlists.length) out.playlists = items as Playlist[];
  }
  return out;
}

/** Charts page (top artists, chart playlists) for a region; anonymous. Throws when nothing parses. */
export async function getCharts(region?: string): Promise<Charts> {
  return q(`getCharts ${region ?? 'auto'}`, async () => {
    const yt = await sessionFor(region);
    const res: any = await yt.actions.execute('/browse', { browseId: 'FEmusic_charts', client: 'YTMUSIC' });
    const out = parseCharts(res.data);
    if (!out.artists.length && !out.playlists.length) throw new Error('charts page had no parsable shelves');
    return out;
  });
}

/** Charts-style discovery (Trending / new releases / new music videos) for a region; anonymous, global default when no region. */
export async function getExplore(region?: string): Promise<Explore> {
  return q(`getExplore ${region ?? 'auto'}`, async () => {
    const yt = await sessionFor(region);
    const res: any = await yt.actions.execute('/browse', { browseId: 'FEmusic_explore', client: 'YTMUSIC' });
    const out = parseExplore(res.data);
    if (!out.topSongs.length && !out.newReleases.length && !out.videos.length) throw new Error('explore page had no parsable shelves');
    return out;
  });
}

export type Mood = { title: string; color: string; /** browse endpoint of the mood/genre page (absent for the static fallback tiles). */ browseId?: string; params?: string };

const MOODS_PAGE = 'FEmusic_moods_and_genres_category';

/**
 * Offline / parse-failure fallback: the well-known mood and genre pages with their browse params (observed from the
 * live "Moods & genres" page), so tiles still open MoodScreen. An empty colour makes the tile pick a vivid one from its title.
 */
export const FALLBACK_MOODS: Mood[] = [
  ['Chill', 'ggMPOg1uX1JOQWZFeDByc2Jm'],
  ['Commute', 'ggMPOg1uX044Z2o5WERLckpU'],
  ['Energize', 'ggMPOg1uX2lRZUZiMnNrQnJW'],
  ['Feel good', 'ggMPOg1uXzZQbDB5eThLRTQ3'],
  ['Focus', 'ggMPOg1uX0NvNGNhWThMYWRh'],
  ['Gaming', 'ggMPOg1uX3NmUVV4Vzl3WGQ0'],
  ['Party', 'ggMPOg1uX2w1aW1CRDFTSUNo'],
  ['Romance', 'ggMPOg1uX1JCQnB2QXVYVEIz'],
  ['Sad', 'ggMPOg1uX3NISTh4UmtWcFgz'],
  ['Sleep', 'ggMPOg1uX1MxaFQ3Z0JMZkN4'],
  ['Workout', 'ggMPOg1uXzIxYkNac21YZ2Z0'],
  ['Classical', 'ggMPOg1uX1N4VmduTmdUR3dm'],
  ['Dance & electronic', 'ggMPOg1uX1NPTld3SDN3WGs4'],
  ['Hip-hop', 'ggMPOg1uX2E4aVJuU05GOVQ0'],
  ['Indie & alternative', 'ggMPOg1uX21NWWpBbU01SDgy'],
  ['Jazz', 'ggMPOg1uX3lPcDFRaE9wM1BS'],
  ['Latin', 'ggMPOg1uX29wWTRjMHV1dWN5'],
  ['Pop', 'ggMPOg1uX1BmNzc2V2p0YXJ5'],
  ['R&B & soul', 'ggMPOg1uX2JxQ2hxc2J5UFhR'],
  ['Rock', 'ggMPOg1uXzJKTm5jUEZ5Uzlu'],
].map(([title, params]) => ({ title, color: '', browseId: MOODS_PAGE, params }));

/** Parses the "Moods & genres" browse response into tiles. Only buttons that carry a browse endpoint with params are kept. */
export function parseMoods(data: any): Mood[] {
  const sections = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const out: Mood[] = [];
  for (const s of sections) {
    for (const it of s.gridRenderer?.items ?? []) {
      const b = it.musicNavigationButtonRenderer;
      const title = b?.buttonText?.runs?.[0]?.text;
      const argb = b?.solid?.leftStripeColor;
      const be = b?.clickCommand?.browseEndpoint;
      if (!title || !be?.params) continue;
      const hex = typeof argb === 'number' ? (argb >>> 0).toString(16).padStart(8, '0').slice(2) : undefined;
      out.push({ title, color: hex ? `#${hex}` : '', browseId: be.browseId ?? MOODS_PAGE, params: be.params });
    }
  }
  return out;
}

/** YT Music "Moods & genres" page. Throws when nothing parses so callers can log the reason and use FALLBACK_MOODS. */
export async function getMoods(): Promise<Mood[]> {
  return q('getMoods', async () => {
    const yt = await getSession();
    const res: any = await yt.actions.execute('/browse', { browseId: 'FEmusic_moods_and_genres', client: 'YTMUSIC' });
    const out = parseMoods(res.data);
    if (!out.length) throw new Error(`moods page had no tiles with params (top-level keys: ${Object.keys(res.data ?? {}).join(',')})`);
    return out;
  });
}

/** A mood/genre page (`FEmusic_moods_and_genres_category` + params) flattened into shelves. */
export async function getMoodPage(params: string, browseId = MOODS_PAGE): Promise<Shelf[]> {
  return q(`getMoodPage ${params.slice(0, 12)}`, async () => {
    const yt: any = await getSession();
    const res: any = await yt.actions.execute('/browse', { browseId, params, client: 'YTMUSIC' });
    const parsed: any = Parser.parseResponse(res.data);
    // Mood pages mix carousels with grids; the carousels hold the playlists worth showing.
    return mapHome({ sections: parsed.contents_memo?.getType(YTNodes.MusicCarouselShelf) ?? [] });
  });
}

// ---- signed-in only ----

export type YtLibrary = {
  liked: Track[];
  playlists: Playlist[];
  albums: Album[];
  artists: Artist[];
  /** Per part: false when it failed or a continuation was left unfollowed, i.e. the list may be cut short (the sync then never deletes from it). */
  complete: { liked: boolean; playlists: boolean; albums: boolean; artists: boolean };
};

/** Flattens a library page's grid / shelf contents into mapped items. */
function libraryItems(lib: any): MusicItem[] {
  return mapItems((lib?.contents ?? []).flatMap((c: any) => c.items ?? c.contents ?? []));
}

/** A filtered library list with its continuations followed (up to `maxPages`); `complete` is false when pages remain or a continuation failed. */
async function allLibraryItems(lib: any, maxPages = 10): Promise<{ items: MusicItem[]; complete: boolean }> {
  let items = libraryItems(lib);
  let page = lib;
  for (let n = 0; page?.has_continuation; n++) {
    if (n >= maxPages) return { items, complete: false };
    try {
      page = await page.getContinuation();
    } catch {
      return { items, complete: false };
    }
    const c = page?.contents;
    items = items.concat(mapItems((Array.isArray(c) ? c : c ? [c] : []).flatMap((x: any) => x.items ?? x.contents ?? [])));
  }
  return { items, complete: true };
}

/** The account's playlists, albums, subscribed artists and liked songs (LM). Each part fails independently and says whether it is complete. */
export async function getYtLibrary(): Promise<YtLibrary> {
  return q('getYtLibrary', async () => {
    const yt = await getSession();
    const out: YtLibrary = { liked: [], playlists: [], albums: [], artists: [], complete: { liked: false, playlists: false, albums: false, artists: false } };
    const part = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        if (authCookie && /status code (401|403)\b/.test(e instanceof Error ? e.message : String(e))) throw e;
        log('api', `ytLibrary ${name} failed: ${e instanceof Error ? e.message : e}`);
      }
    };
    await part('liked', async () => {
      let page: Page<Track> | undefined = (await getPlaylist('LM')).tracks;
      for (let i = 0; page && i < 10; i++) {
        out.liked.push(...page.items);
        page = page.next ? await page.next() : undefined;
      }
      out.complete.liked = !page;
    });
    const lib = await yt.music.getLibrary();
    await part('playlists', async () => {
      const r = await allLibraryItems(await lib.applyFilter('Playlists'));
      out.playlists = r.items.filter((x): x is Playlist => x.kind === 'playlist' && x.id !== 'LM' && x.id !== 'SE');
      out.complete.playlists = r.complete;
    });
    await part('albums', async () => {
      const r = await allLibraryItems(await lib.applyFilter('Albums'));
      out.albums = r.items.filter((x): x is Album => x.kind === 'album');
      out.complete.albums = r.complete;
    });
    await part('artists', async () => {
      const r = await allLibraryItems(await lib.applyFilter('Artists'));
      out.artists = r.items.filter((x): x is Artist => x.kind === 'artist');
      out.complete.artists = r.complete;
    });
    return out;
  });
}

/** Mirrors a like to YouTube Music. Throws on failure so the caller can roll back its optimistic update. */
export async function setYtLike(videoId: string, on: boolean): Promise<void> {
  await q(`like ${videoId}=${on}`, async () => {
    const yt = await getSession();
    await (on ? yt.interact.like(videoId) : yt.interact.removeRating(videoId));
  });
}

/** The channel id to subscribe with: the page header's, else the artist browse id when it is already a channel id (UC...). */
export const channelIdOf = (a: Pick<Artist, 'id' | 'channelId'>): string | undefined => a.channelId ?? (/^UC[\w-]{20,}$/.test(a.id) ? a.id : undefined);

/** Mirrors a follow to YouTube Music (subscribe / unsubscribe the artist channel). Throws on failure so the caller can roll back. */
export async function setYtSubscribe(artist: Pick<Artist, 'id' | 'channelId'>, on: boolean): Promise<void> {
  const channel = channelIdOf(artist);
  if (!channel) {
    log('api', `no channel id for artist ${artist.id}, not mirroring the follow`);
    return;
  }
  await q(`subscribe ${channel}=${on}`, async () => {
    const yt = await getSession();
    await (on ? yt.interact.subscribe(channel) : yt.interact.unsubscribe(channel));
  });
}

/** Adds a played track to the account's YouTube watch history (only when the user enabled it). */
export async function reportYtPlayback(videoId: string): Promise<void> {
  await q(`reportPlayback ${videoId}`, async () => {
    const info = await (await getSession()).music.getInfo(videoId);
    await info.addToWatchHistory();
  });
}
