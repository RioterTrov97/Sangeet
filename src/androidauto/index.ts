import { AndroidAutoMediaLibraryHelper, PlayerQueue, type MediaItem } from 'react-native-nitro-player';

import { downloadedGroups, downloadedTracks } from '../downloads/manager';
import { localTracks } from '../local';
import { localPlaylistTracks } from '../library/store';
import { adoptNativePlaylist, currentPlaylistId, resumePlayback, toItem } from '../player/queue';
import { getHistory } from '../player/history';
import { log, logWarn } from '../util/log';
import { addRecent } from '../search/recent';
import { getJson, setJson } from '../util/storage';
import { searchAll } from '../youtube/api';
import type { Album, Artist, Playlist, Track } from '../youtube/models';
import { album, artist, downloadsData, homeShelves, libraryData, playlist } from '../carplay';
import { androidAutoOn } from './flag';
import {
  buildRoot,
  downloadsNodes,
  homeNodes,
  isAaPlaylistName,
  libraryListNodes,
  libraryNodes,
  MAX_SEARCH_SONGS,
  parseOpen,
  parseSearch,
  playlistName,
  recentSearchNodes,
  searchItems,
  shelfNodes,
  songItems,
  toItems,
  type LibraryData,
  type Node,
} from './tree';

export { androidAutoOn } from './flag';

/**
 * Android Auto wiring (the CarPlay counterpart, src/carplay). Runs at module scope from src/boot.ts so the car can browse and play
 * with no phone UI. Folders are loaded lazily from the persisted TanStack cache; every list of songs is a native playlist named
 * `aa:<context>`; when the car plays from one, the bridge adopts it as the queue (`adoptIfFromCar`).
 */

/** context -> native playlist (re-created when its songs change). */
const lists = new Map<string, { id: string; sig: string; tracks: Track[]; title: string }>();
const MAX_LISTS = 40;

async function ensureList(ctx: string, title: string, tracks: Track[]): Promise<string> {
  const sig = tracks.map((t) => t.id).join(',');
  const hit = lists.get(ctx);
  if (hit && hit.sig === sig && (await Promise.resolve(PlayerQueue.getPlaylist(hit.id)))) return hit.id;
  if (hit && hit.id !== currentPlaylistId()) void Promise.resolve(PlayerQueue.deletePlaylist(hit.id)).catch(() => {});
  // Old lists nobody is playing from: keep the native playlist count bounded.
  if (lists.size >= MAX_LISTS) {
    for (const [k, v] of lists) {
      if (k !== ctx && v.id !== currentPlaylistId()) {
        lists.delete(k);
        void Promise.resolve(PlayerQueue.deletePlaylist(v.id)).catch(() => {});
        break;
      }
    }
  }
  const id = await PlayerQueue.createPlaylist(playlistName(ctx));
  await PlayerQueue.addTracksToPlaylist(id, tracks.map(toItem));
  lists.set(ctx, { id, sig, tracks, title });
  return id;
}

async function listNodes(nodes: Node[]): Promise<MediaItem[]> {
  await Promise.all(nodes.map((n) => (n.kind === 'songs' && n.tracks.length ? ensureList(n.ctx, n.title, n.tracks) : undefined)));
  return toItems(nodes.filter((n) => n.kind !== 'songs' || n.tracks.length), (ctx) => lists.get(ctx)?.id);
}

async function songRows(ctx: string, title: string, tracks: Track[]): Promise<MediaItem[]> {
  if (!tracks.length) return [];
  return songItems(await ensureList(ctx, title, tracks), tracks);
}

function library(): LibraryData {
  const d = libraryData();
  return { liked: d.liked, playlists: d.playlists ?? [], albums: d.recentAlbums, artists: d.recentArtists };
}

async function loader(parent: string): Promise<MediaItem[]> {
  log('androidauto', `load ${parent}`);
  switch (parent) {
    case 'home': {
      const s = (await homeShelves().catch(() => undefined)) as Awaited<ReturnType<typeof homeShelves>> | undefined;
      return listNodes(homeNodes({ shelves: s, recents: getHistory().slice(0, 50), searches: recentSearches() }));
    }
    case 'library':
      return listNodes(libraryNodes(library()));
    case 'recents':
      return songRows('recents', 'Recently played', getHistory().slice(0, 100));
    case 'downloads':
      return listNodes(downloadsNodes({ ...downloadsData(), tracks: [...downloadedTracks(), ...localTracks()] }));
    case 'searches':
      return listNodes(recentSearchNodes(recentSearches()));
  }
  const query = parseSearch(parent);
  if (query) return searchResults(query, false);
  const open = parseOpen(parent);
  if (open) {
    switch (open.what) {
      case 'album':
        return songRows(`album:${open.id}`, 'Album', (await album(open.id)).tracks);
      case 'artist':
        return songRows(`artist:${open.id}`, 'Artist', (await artist(open.id)).topSongs);
      case 'playlist': {
        if (open.id.startsWith('local:')) return songRows(`playlist:${open.id}`, 'Playlist', localPlaylistTracks(open.id.slice(6)));
        return songRows(`playlist:${open.id}`, 'Playlist', (await playlist(open.id)).tracks);
      }
    }
  }
  if (parent.startsWith('shelf:')) return listNodes(shelfNodes((await homeShelves().catch(() => undefined)) as Awaited<ReturnType<typeof homeShelves>> | undefined, Number(parent.slice(6))));
  if (parent.startsWith('lib:')) return listNodes(libraryListNodes(parent.slice(4), library()));
  if (parent.startsWith('dgroup:')) {
    const key = parent.slice(7);
    const g = downloadedGroups().find((x) => `${x.kind}:${x.id}` === key);
    const byId = new Map(downloadedTracks().map((t) => [t.id, t]));
    return songRows(`dgroup:${key}`, g?.name ?? 'Downloaded', (g?.trackIds ?? []).flatMap((id) => byId.get(id) ?? []));
  }
  return [];
}

/** The phone's recent searches (src/ui/SearchScreen.tsx keeps them under the same key); car searches are added to it. */
const RECENT_KEY = 'search.recent';
const recentSearches = (): string[] => getJson<string[]>(RECENT_KEY) ?? [];

/**
 * Results for a query typed (parked) or spoken in the car, or a recent search opened from Home: the top songs (one native
 * playlist, so playing one queues the rest) and a few albums and artists. `remember` adds the query to the recent searches.
 * Voice "play X on Sangeet" also lands here through the player's search fallback, which plays the first song.
 */
async function searchResults(query: string, remember: boolean): Promise<MediaItem[]> {
  const q = query.trim();
  if (!q) return [];
  if (remember) setJson(RECENT_KEY, addRecent(recentSearches(), q));
  const shelves = await searchAll(q);
  const items = shelves.flatMap((sh) => sh.items);
  const seen = new Set<string>();
  const tracks = items.filter((x): x is Track => x.kind === 'track' && !seen.has(x.id) && !!seen.add(x.id)).slice(0, MAX_SEARCH_SONGS);
  const collections = items.filter((x): x is Album | Artist | Playlist => x.kind === 'album' || x.kind === 'artist');
  const playlistId = tracks.length ? await ensureList(`search:${q.toLowerCase()}`, `Search: ${q}`, tracks) : undefined;
  return searchItems(playlistId, tracks, collections);
}

let started = false;
export function setupAndroidAuto(): void {
  if (started || !androidAutoOn || !AndroidAutoMediaLibraryHelper.isAvailable()) return;
  started = true;
  AndroidAutoMediaLibraryHelper.set({ layoutType: 'list', rootItems: buildRoot(), appName: 'Sangeet' });
  AndroidAutoMediaLibraryHelper.setChildrenLoader((id) => loader(id).catch((e) => (logWarn('androidauto', `load ${id} failed`, e instanceof Error ? e.message : e), [])));
  AndroidAutoMediaLibraryHelper.setSearchHandler((q) => searchResults(q, true).catch((e) => (logWarn('androidauto', 'search failed', e instanceof Error ? e.message : e), [])));
  // The car asked to play with nothing loaded (auto-play on connect): bring the last queue back.
  AndroidAutoMediaLibraryHelper.onPlaybackResumption(() => void resumePlayback());
  log('androidauto', 'browse tree registered');
}

/** A native track change: when it came from one of the car's lists, make that list the queue so the app UI and skip logic follow. */
export function adoptIfFromCar(trackId: string): void {
  if (!androidAutoOn) return;
  const pid = Promise.resolve(PlayerQueue.getCurrentPlaylistId());
  void pid.then(async (id) => {
    if (!id || id === currentPlaylistId()) return;
    const hit = [...lists.entries()].find(([, v]) => v.id === id);
    if (!hit) return;
    const [ctx, v] = hit;
    if (adoptNativePlaylist(id, v.tracks, trackId, `aa:${ctx}`, v.title)) log('androidauto', `adopted ${ctx} at ${trackId}`);
  });
}

export const isCarPlaylistName = isAaPlaylistName;
