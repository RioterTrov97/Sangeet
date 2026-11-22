import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import StreamProxy from '../../modules/stream-proxy';
import { getDb } from '../db/client';
import { getTracks, playStats } from '../db/repo';
import { useLibraryStore } from '../library/store';
import { playerState } from '../player/store';
import { log, logWarn } from '../util/log';
import { hasLetterbox, pickArtwork, ytimgFallbacks } from '../youtube/mappers/common';
import type { Track } from '../youtube/models';
import { isLocalId } from '../local/id';
import { isDownloaded, localArtworkUrl } from './manager';
import { isOffline, onNetChange } from './net';
import { AUTO_CACHE_OPTIONS_MB, downloadSettings, useDownloadSettings } from './settings';

/**
 * Automatic offline storage: every played song is saved whole by the stream proxy (see modules/stream-proxy SongCache).
 * It is separate from manual downloads (never evicted, not counted here). When over budget, songs are evicted by value.
 */
export type CacheEntry = { id: string; bytes: number; playCount: number; liked: boolean; lastPlayed: number };

/**
 * Eviction order, first to go first: one-off songs (played once or never, not liked), oldest first; then the other
 * unliked songs, least played first (older first on ties); liked songs last, least played first.
 */
export function evictionOrder(entries: readonly CacheEntry[]): string[] {
  const tier = (e: CacheEntry) => (e.liked ? 2 : e.playCount <= 1 ? 0 : 1);
  return [...entries]
    .sort((a, b) => tier(a) - tier(b) || (tier(a) === 0 ? 0 : a.playCount - b.playCount) || a.lastPlayed - b.lastPlayed)
    .map((e) => e.id);
}

/** The ids to delete so the rest fits `limitBytes` (0 = nothing is kept). `protect` ids (playing / queued next) stay. */
export function planAutoTrim(entries: readonly CacheEntry[], limitBytes: number, protect: ReadonlySet<string> = new Set()): string[] {
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  if (limitBytes > 0 && total <= limitBytes) return [];
  const bytes = new Map(entries.map((e) => [e.id, e.bytes]));
  const out: string[] = [];
  for (const id of evictionOrder(entries)) {
    if (limitBytes > 0 && total <= limitBytes) break;
    if (protect.has(id)) continue;
    out.push(id);
    total -= bytes.get(id) ?? 0;
  }
  return out;
}

type State = { ids: Record<string, number>; bytes: number };
export const useAutoCache = create<State>(() => ({ ids: {}, bytes: 0 }));

/** True when the song is saved whole in the automatic cache (plays with no network). */
export const isAutoCached = (id: string): boolean => id in useAutoCache.getState().ids;
export const useIsAutoCached = (id?: string): boolean => useAutoCache((s) => (id ? id in s.ids : false));
/** Manual download, automatic cache, or a song from this iPhone (a file on the device): playable offline. */
export const isAvailableOffline = (id: string): boolean => isLocalId(id) || isDownloaded(id) || isAutoCached(id);

function list(): { id: string; bytes: number; lastUsed: number }[] {
  try {
    return StreamProxy.cacheList?.() ?? [];
  } catch {
    return [];
  }
}

function refresh(): void {
  const rows = list();
  useAutoCache.setState({ ids: Object.fromEntries(rows.map((r) => [r.id, r.bytes])), bytes: rows.reduce((n, r) => n + r.bytes, 0) });
  sweepArt();
}

/*
 * Artwork of automatically saved songs, so the lock screen and Now Playing have a picture with no network. Kept in
 * Documents like the songs' own folder is kept out of Caches (iOS empties Caches when storage runs low); an image whose
 * song is gone is deleted on the next refresh.
 */
const artDir = () => new Directory(Paths.document, 'songs-art');

/** Earlier builds kept the artwork in Caches: move it next to the rest once. */
function migrateArt(): void {
  try {
    const old = new Directory(Paths.cache, 'songs-art');
    if (!old.exists) return;
    const d = artDir();
    if (!d.exists) d.create({ intermediates: true });
    let n = 0;
    for (const f of old.list()) {
      if (!(f instanceof File)) continue;
      const to = new File(d, f.name);
      if (to.exists) continue;
      f.move(to);
      n++;
    }
    old.delete();
    if (n) log('cache', `moved ${n} artwork file(s) out of Caches`);
  } catch (e) {
    logWarn('cache', 'artwork move failed', e instanceof Error ? e.message : e);
  }
}
/** `-lb`: a 4:3 frame with the picture letterboxed (sd/hqdefault); the lock screen crops the bars off by that name. */
const artFile = (id: string, letterboxed = false) => new File(artDir(), `${id}${letterboxed ? '-lb' : ''}.jpg`);
let artChain: Promise<void> = Promise.resolve();

/** `file://` URL of a saved song's artwork, if we have it. */
/** The artwork saved on this device for a downloaded or automatically saved song (file uri), if any. */
export function savedArtworkUrl(id: string): string | undefined {
  return localArtworkUrl(id) ?? autoArtworkUrl(id);
}

export function autoArtworkUrl(id: string): string | undefined {
  if (!isAutoCached(id)) return undefined;
  try {
    return [artFile(id), artFile(id, true)].find((f) => f.exists)?.uri;
  } catch {
    return undefined;
  }
}

/** Saves `id`'s artwork (one at a time: parallel downloads collide in expo-file-system's temp file). */
const artQueued = new Set<string>();
function saveArt(id: string): boolean {
  if (artQueued.has(id)) return false;
  artQueued.add(id);
  artChain = artChain.then(() => doSaveArt(id)).catch(() => {}).finally(() => artQueued.delete(id));
  return true;
}
async function doSaveArt(id: string): Promise<void> {
  if (isDownloaded(id) || isOffline() || !isAutoCached(id)) return;
  if (autoArtworkUrl(id)) return;
  let t: Track | undefined;
  try {
    t = getTracks(getDb(), [id]).get(id);
  } catch {
    t = undefined;
  }
  t ??= playerState().queue.find((q) => q.id === id);
  // No metadata (a prefetched song never played) or no artwork in it: the song id is a video id, use its frame.
  const url = (t && pickArtwork(t.artwork, 544)) || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  const d = artDir();
  if (!d.exists) d.create({ intermediates: true });
  // A video frame's maxresdefault often does not exist: fall back the way the Artwork view does.
  let err: unknown;
  for (const u of [url, ...ytimgFallbacks(url)]) {
    const f = artFile(id, hasLetterbox(u));
    try {
      await File.downloadFileAsync(u, f);
      return;
    } catch (e) {
      err = e;
      try {
        if (f.exists) f.delete();
      } catch {}
    }
  }
  logWarn('cache', `artwork ${id} failed: ${err instanceof Error ? err.message : err}`);
}

/** Deletes artwork whose song is no longer saved here. */
function sweepArt(): void {
  try {
    const d = artDir();
    if (!d.exists) return;
    const ids = useAutoCache.getState().ids;
    for (const f of d.list()) {
      if (f instanceof File && !(f.name.replace(/(-lb)?\.jpg$/, '') in ids)) f.delete();
    }
  } catch (e) {
    logWarn('cache', 'artwork sweep failed', e instanceof Error ? e.message : e);
  }
}

/** Fills in artwork for saved songs that have none (songs saved before this existed, or a save that failed offline). */
function backfillArt(): void {
  if (isOffline()) return;
  const missing = Object.keys(useAutoCache.getState().ids).filter((id) => !isDownloaded(id) && !autoArtworkUrl(id));
  const queued = missing.filter(saveArt).length;
  if (queued) log('cache', `saving artwork for ${queued} saved song(s)`);
}

let protectIds: () => ReadonlySet<string> = () => new Set();
/** The queue tells us which songs must not be evicted (current and the next two). */
export const setAutoCacheProtect = (fn: () => ReadonlySet<string>) => void (protectIds = fn);

export function trimAutoCache(): void {
  const rows = list();
  const limit = downloadSettings().autoCacheMb * 1024 * 1024;
  let stats: ReturnType<typeof playStats> | undefined;
  try {
    stats = playStats(getDb());
  } catch {
    stats = undefined;
  }
  const liked = new Set(useLibraryStore.getState().liked.map((t) => t.id));
  const entries: CacheEntry[] = rows.map((r) => ({ id: r.id, bytes: r.bytes, playCount: stats?.get(r.id)?.count ?? 0, liked: liked.has(r.id), lastPlayed: stats?.get(r.id)?.last ?? r.lastUsed }));
  // A manually downloaded song does not need its second copy here.
  const dupes = entries.filter((e) => isDownloaded(e.id)).map((e) => e.id);
  const rest = entries.filter((e) => !dupes.includes(e.id));
  const drop = [...dupes, ...planAutoTrim(rest, limit, protectIds())];
  for (const id of drop) StreamProxy.cacheDelete?.(id);
  if (drop.length) log('cache', `evicted ${drop.length} song(s) (${drop.slice(0, 3).join(',')}${drop.length > 3 ? '…' : ''}); limit ${Math.round(limit / 1048576)} MB`);
  refresh();
}

/** The automatically saved songs (not also manually downloaded), most recently used first, with the metadata we have for them. */
export function autoCachedTracks(): Track[] {
  const rows = list().filter((r) => !isDownloaded(r.id)).sort((a, b) => b.lastUsed - a.lastUsed);
  if (!rows.length) return [];
  let meta: Map<string, Track>;
  try {
    meta = getTracks(getDb(), rows.map((r) => r.id));
  } catch {
    meta = new Map();
  }
  return rows.flatMap((r) => (meta.get(r.id) ? [meta.get(r.id)!] : []));
}

/** Removes one automatically saved song from this device. */
export function removeAutoCached(id: string): void {
  StreamProxy.cacheDelete?.(id);
  refresh();
}

export function clearAutoCache(): void {
  StreamProxy.cacheClear?.();
  refresh();
}

/** TV: nothing is saved while streaming, and songs a previous build saved are deleted. */
export function disableAutoCache(): void {
  try {
    StreamProxy.cacheConfigure?.(0);
    StreamProxy.cacheClear?.();
  } catch (e) {
    logWarn('cache', 'disable failed', e instanceof Error ? e.message : e);
  }
  useAutoCache.setState({ ids: {}, bytes: 0 });
  sweepArt();
}

let started = false;
/** Applies the budget, keeps the offline-availability set fresh and trims by value whenever a song finishes caching. */
export function startAutoCache(): void {
  if (started) return;
  started = true;
  const apply = () => StreamProxy.cacheConfigure?.(downloadSettings().autoCacheMb * 1024 * 1024);
  try {
    migrateArt();
    apply();
    refresh();
    StreamProxy.addListener('onSongCached', ({ id }) => {
      try {
        trimAutoCache();
      } catch (e) {
        logWarn('cache', 'trim failed', e instanceof Error ? e.message : e);
      }
      saveArt(id);
    });
    let last = downloadSettings().autoCacheMb;
    useDownloadSettings.subscribe((s) => {
      if (s.autoCacheMb === last) return;
      last = s.autoCacheMb;
      apply();
      trimAutoCache();
    });
    trimAutoCache();
    backfillArt();
    onNetChange(() => {
      if (!isOffline()) backfillArt();
    });
  } catch (e) {
    logWarn('cache', 'auto cache unavailable', e instanceof Error ? e.message : e);
  }
}

export { AUTO_CACHE_OPTIONS_MB };
