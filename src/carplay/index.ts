import { Platform } from 'react-native';
import { CarPlayHelper, type CarPlayListTemplate } from 'react-native-nitro-player';

import { downloadedGroups, downloadedTracks, useDownloads } from '../downloads/manager';
import { localTracks } from '../local';
import { libraryItems } from '../library/items';
import { libraryState, localPlaylistTracks, useLibraryStore } from '../library/store';
import { getHistory, onHistoryChange, recentAlbums } from '../player/history';
import { prefetch } from '../player/proxy';
import { playTracksLocal as playTracks, resumePlayback } from '../player/queue';
import { playerState, usePlayerStore } from '../player/store';
import { handleSiriIntent } from '../siri/handler';
import { getJson } from '../util/storage';
import { log, logWarn } from '../util/log';
import { getAlbum, getArtist, getHome, getPlaylist } from '../youtube/api';
import type { Shelf, Track } from '../youtube/models';
import { queryClient, restoreQueryCache } from '../youtube/queryClient';
import {
  buildAlbum,
  buildArtist,
  buildDownloads,
  buildHome,
  buildLibrary,
  type LibraryData,
  buildLibraryAlbums,
  buildLibraryArtists,
  buildLibraryPlaylists,
  buildLiked,
  buildOffline,
  buildPlaylist,
  buildRecents,
  buildRoot,
  parseOpenId,
  parseRowId,
  quickPicks,
  type HomeData,
  type DownloadsData,
} from './templates';

/**
 * CarPlay wiring. `setupCarPlay()` runs at module scope from `src/boot.ts`, so it also runs when CarPlay launches the
 * app with no phone UI. Tabs are lazy templates: they appear immediately and are filled from the persisted TanStack
 * cache; stale data is refreshed in the background and `CarPlayHelper.reload(id)` redraws the tab when it changed.
 * Overall shape follows Jellify's CarPlay service (MIT): https://github.com/Jellify-Music/App
 */

const HOME_KEY = ['yt', 'home'];
const FETCH_TIMEOUT_MS = 8000;
const STALE_MS = 5 * 60_000;

const withTimeout = <T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** First page of a playlist only (paged queries hold closures and are not persisted). */
async function fetchPlaylist(id: string) {
  const p = await getPlaylist(id);
  return { playlist: p.playlist, tracks: p.tracks.items };
}

const fingerprint = (v: unknown) => JSON.stringify(v)?.length ?? 0;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Cache first: returns persisted data at once (refreshing it in the background when stale and calling `onChange` if
 * the refreshed data differs). Without cache it waits for the network, bounded by a timeout.
 */
async function cached<T>(key: unknown[], fn: () => Promise<T>, onChange?: () => void): Promise<T> {
  await restoreQueryCache();
  const hit = queryClient.getQueryData<T>(key);
  if (hit !== undefined) {
    const at = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (Date.now() - at > STALE_MS) {
      queryClient
        .fetchQuery({ queryKey: key, queryFn: fn, staleTime: 0 })
        .then((fresh) => {
          if (fingerprint(fresh) !== fingerprint(hit)) onChange?.();
        })
        .catch((e) => log('carplay', `background refresh ${key.join('/')} failed: ${msg(e)}`));
    }
    return hit;
  }
  return withTimeout(queryClient.fetchQuery({ queryKey: key, queryFn: fn, staleTime: STALE_MS }));
}

export const homeShelves = (onChange?: () => void) => cached<Shelf[]>(HOME_KEY, getHome, onChange);
export const album = (id: string) => cached(['yt', 'album', id], () => getAlbum(id));
export const artist = (id: string) => cached(['yt', 'artist', id], () => getArtist(id));
export const playlist = (id: string) => cached(['yt', 'cp-playlist', id], () => fetchPlaylist(id));

// ---- loaders ----

function resumeInfo(): HomeData['resume'] {
  const s = playerState();
  const track = s.queue[s.index];
  return track ? { track, paused: s.status !== 'playing' && s.status !== 'buffering' } : undefined;
}

async function loadHome(): Promise<CarPlayListTemplate> {
  const recents = getHistory();
  let shelves: Shelf[] | undefined;
  let offline = false;
  try {
    shelves = await homeShelves(() => CarPlayHelper.reload('home'));
  } catch (e) {
    offline = true;
    logWarn('carplay', 'home unavailable', msg(e));
  }
  return buildHome({ shelves, resume: resumeInfo(), recents, recentAlbums: recentAlbums(recents), offline, recentSearches: getJson<string[]>('search.recent') ?? [] });
}

/** Real library data: liked tracks, saved playlists, and saved + recently played albums/artists. */
export function libraryData(): LibraryData {
  const { liked, saved } = libraryState();
  const h = getHistory();
  const pick = (f: 'albums' | 'artists') => libraryItems(f, saved, h, 'recent').map((x) => ({ id: x.id, name: x.kind === 'artist' ? x.name : x.title, artwork: x.artwork }));
  const local = libraryState().playlists.map((p) => ({ id: `local:${p.id}`, name: p.name, artwork: p.art[0] ?? [], subtitle: `${p.count} songs` }));
  const playlists = [...local, ...saved.filter((x) => x.kind === 'playlist').map((p) => ({ id: p.id, name: p.title, artwork: p.artwork, subtitle: p.author }))];
  return { liked, recentAlbums: pick('albums'), recentArtists: pick('artists'), playlists };
}

export function downloadsData(): DownloadsData {
  // Songs from this iPhone are on the device like downloads, so they are listed here too.
  const tracks = [...downloadedTracks(), ...localTracks()];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return { tracks, groups: downloadedGroups().map((g) => ({ kind: g.kind, id: g.id, name: g.name, count: g.trackIds.length, artwork: byId.get(g.trackIds[0])?.artwork ?? [] })) };
}

async function loader(id: string): Promise<CarPlayListTemplate | null> {
  log('carplay', `load ${id}`);
  if (id === 'home') return loadHome();
  if (id === 'library') {
    return buildLibrary(libraryData());
  }
  if (id === 'recents') return buildRecents(getHistory());
  if (id === 'downloads') return buildDownloads(downloadsData());

  const open = parseOpenId(id);
  if (!open) return null;
  try {
    switch (open.what) {
      case 'album':
        return buildAlbum(await album(open.id));
      case 'artist':
        return buildArtist(await artist(open.id));
      case 'dgroup': {
        const g = downloadedGroups().find((x) => `${x.kind}:${x.id}` === open.id);
        const byId = new Map(downloadedTracks().map((t) => [t.id, t]));
        return buildPlaylist(`dg:${open.id}`, g?.name ?? 'Downloaded', (g?.trackIds ?? []).flatMap((id) => byId.get(id) ?? []));
      }
      case 'playlist': {
        if (open.id.startsWith('local:')) {
          const pl = libraryState().playlists.find((x) => x.id === open.id.slice(6));
          return buildPlaylist(open.id, pl?.name ?? 'Playlist', localPlaylistTracks(open.id.slice(6)));
        }
        const p = await playlist(open.id);
        return buildPlaylist(open.id, p.playlist.title, p.tracks);
      }
      case 'liked':
        return buildLiked(libraryState().liked);
      case 'library':
        if (open.id === 'playlists') return buildLibraryPlaylists(libraryData().playlists ?? []);
        return open.id === 'albums' ? buildLibraryAlbums(libraryData().recentAlbums) : buildLibraryArtists(libraryData().recentArtists);
    }
  } catch (e) {
    logWarn('carplay', `load ${id} failed`, msg(e));
    return buildOffline(id, open.what === 'album' ? 'Album' : open.what === 'artist' ? 'Artist' : 'Playlist');
  }
  return null;
}

// ---- playing ----

/** Resolves a row's context key to its tracks. Everything derives from the cache, so rows work right after a cold start. */
async function resolveContext(ctx: string): Promise<{ tracks: Track[]; source: string } | undefined> {
  if (ctx === 'recents') return { tracks: getHistory(), source: 'recents' };
  if (ctx === 'downloads') return { tracks: [...downloadedTracks(), ...localTracks()], source: 'downloads' };
  if (ctx.startsWith('dg:')) {
    const g = downloadedGroups().find((x) => `dg:${x.kind}:${x.id}` === ctx);
    const byId = new Map(downloadedTracks().map((t) => [t.id, t]));
    return { tracks: (g?.trackIds ?? []).flatMap((id) => byId.get(id) ?? []), source: ctx };
  }
  if (ctx.startsWith('playlist:local:')) return { tracks: localPlaylistTracks(ctx.slice(15)), source: ctx };
  if (ctx === 'liked') return { tracks: libraryState().liked, source: 'liked' };
  const cut = ctx.indexOf(':');
  const kind = ctx.slice(0, cut);
  const id = ctx.slice(cut + 1);
  switch (kind) {
    case 'home': {
      const shelves = await homeShelves();
      const qp = quickPicks(shelves);
      const tracks = qp?.ctx === ctx ? qp.tracks : shelves[Number(id)]?.items.filter((x): x is Track => x.kind === 'track');
      return tracks?.length ? { tracks, source: 'home' } : undefined;
    }
    case 'album':
      return { tracks: (await album(id)).tracks, source: ctx };
    case 'artist':
      return { tracks: (await artist(id)).topSongs, source: ctx };
    case 'playlist':
      return { tracks: (await playlist(id)).tracks, source: ctx };
  }
}

async function playRow(id: string): Promise<void> {
  const a = parseRowId(id);
  switch (a.kind) {
    case 'resume': {
      if (await resumePlayback()) CarPlayHelper.showNowPlaying();
      return;
    }
    case 'siri':
      if ((await handleSiriIntent({})) === 'success') CarPlayHelper.showNowPlaying();
      return;
    case 'recentSearch':
      if ((await handleSiriIntent({ mediaName: a.query, mediaType: 'song' })) === 'success') CarPlayHelper.showNowPlaying();
      return;
    case 'retry':
      return CarPlayHelper.reload(a.target);
    case 'playctx': {
      const c = await resolveContext(a.ctx);
      if (!c?.tracks.length) return void logWarn('carplay', `empty context ${a.ctx}`);
      await playTracks(c.tracks, 0, { source: c.source, shuffle: a.shuffle });
      return CarPlayHelper.showNowPlaying();
    }
    case 'track': {
      const c = await resolveContext(a.ctx).catch(() => undefined);
      const i = c ? c.tracks.findIndex((t) => t.id === a.videoId) : -1;
      if (c && i >= 0) await playTracks(c.tracks, i, { source: c.source });
      else {
        // Context unavailable (cache evicted, offline): play the song itself; queue radio fills the rest.
        const known = [...getHistory(), ...playerState().queue].find((t) => t.id === a.videoId);
        await playTracks([known ?? { kind: 'track', id: a.videoId, title: 'Song', artists: [], artwork: [] }], 0, { source: 'carplay' });
      }
      return CarPlayHelper.showNowPlaying();
    }
    default:
      logWarn('carplay', `unhandled row ${id}`);
  }
}

// ---- setup ----

let started = false;
export function setupCarPlay(): void {
  if (started) return;
  started = true;
  if (Platform.OS !== 'ios' || !CarPlayHelper.isAvailable()) return;

  CarPlayHelper.setTemplateLoader(loader);
  CarPlayHelper.onSelect((id, templateId) => {
    log('carplay', `select ${id} in ${templateId}`);
    playRow(id).catch((e) => logWarn('carplay', `select ${id} failed`, msg(e)));
  });
  CarPlayHelper.set(buildRoot());

  // Plain subscription instead of useCarPlayConnection: there is no React tree on a CarPlay-only launch.
  CarPlayHelper.onConnectionChange((connected) => {
    log('carplay', connected ? 'connected' : 'disconnected');
    if (connected) void warmUp();
  });
  if (CarPlayHelper.isConnected()) void warmUp();

  // Keep "Continue" and "Recents" honest without redrawing on every progress tick.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshSoon = (...ids: string[]) => {
    if (!CarPlayHelper.isConnected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => ids.forEach((i) => CarPlayHelper.reload(i)), 1500);
  };
  usePlayerStore.subscribe((s, prev) => {
    const cur = s.queue[s.index]?.id;
    if (cur !== prev.queue[prev.index]?.id || (s.status === 'playing') !== (prev.status === 'playing')) refreshSoon('home');
  });
  onHistoryChange(() => refreshSoon('recents', 'library'));
  useLibraryStore.subscribe(() => refreshSoon('library'));
  let dlRev = 0;
  useDownloads.subscribe((s) => {
    if (s.rev !== dlRev) {
      dlRev = s.rev;
      refreshSoon('downloads');
    }
  });
  log('carplay', 'templates registered');
}

/** On connect with nothing playing: resolve the likely first track (Continue, else first quick pick) ahead of the tap. */
async function warmUp(): Promise<void> {
  const s = playerState();
  if (s.status === 'playing' || s.status === 'buffering') return;
  const resume = s.queue[s.index];
  if (resume) return void prefetch(resume.id);
  try {
    const first = quickPicks(await homeShelves())?.tracks[0];
    if (first) prefetch(first.id);
  } catch {
    /* offline: nothing to warm */
  }
}
