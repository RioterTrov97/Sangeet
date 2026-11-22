import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import { getDb } from '../db/client';
import * as repo from '../db/repo';
import type { DownloadRow } from '../db/repo';
import { initLibrary, useLibraryStore } from '../library/store';
import { isLocalId } from '../local/id';
import { AppState } from 'react-native';

import StreamProxy from '../../modules/stream-proxy';
import { resolver } from '../player/proxy';
import { pickArtwork } from '../youtube/mappers/common';
import { log, logWarn } from '../util/log';
import type { Track } from '../youtube/models';
import { gbToBytes, planEviction } from './lru';
import { isOffline, onNetChange, useNet } from './net';
import { DownloadQueue, type Job } from './queue';
import { downloadSettings, useDownloadSettings } from './settings';

/**
 * Offline downloads. The resolved upstream URL is handed to a background URLSession (modules/stream-proxy,
 * BackgroundDownloader) that fetches 4 MB ranges into `Documents/downloads/<id>.m4a.part` and renames it when complete
 * (applying the same mdhd duration patch the proxy applies), so transfers continue while the app is suspended. Artwork is stored next to it for CarPlay / offline use.
 * (nitro-player's DownloadManager was not used: it keeps its own store and cannot use our lazy proxy resolution, and
 * we want one source of truth in SQLite.)
 */

type DlState = { byId: Record<string, DownloadRow>; rev: number };
export const useDownloads = create<DlState>(() => ({ byId: {}, rev: 0 }));

export type GroupInfo = { kind: 'album' | 'playlist' | 'liked'; id: string; name: string };

const dir = () => new Directory(Paths.document, 'downloads');
const audioFile = (id: string) => new File(dir(), `${id}.m4a`);
const partFile = (id: string) => new File(dir(), `${id}.m4a.part`);
const artFile = (id: string) => new File(dir(), `${id}.jpg`);

const pending = new Map<string, Track>(); // tracks queued in this session (metadata for artwork)
let queue: DownloadQueue | undefined;

function refresh(): void {
  const byId: Record<string, DownloadRow> = {};
  for (const r of repo.allDownloads(getDb())) byId[r.trackId] = r;
  useDownloads.setState((s) => ({ byId, rev: s.rev + 1 }));
}

let lastTick = 0;
/** In-memory progress for the UI rings (4 Hz); the DB only sees state changes. */
function uiProgress(j: Job): void {
  const now = Date.now();
  if (now - lastTick < 250) return;
  lastTick = now;
  useDownloads.setState((s) => (s.byId[j.id] ? { byId: { ...s.byId, [j.id]: { ...s.byId[j.id], bytes: j.bytes, totalBytes: j.total } } } : s));
}

const persist = (j: Job) => {
  repo.patchDownload(getDb(), j.id, { state: j.state, bytes: j.bytes, totalBytes: j.total, attempts: j.attempts, error: j.error ?? null, ...(j.state === 'done' ? { path: audioFile(j.id).uri } : {}) });
  refresh();
  if (j.state === 'done') enforceLimit();
};

const stripFile = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ''));

type Waiter = { resolve: (r: { bytes: number }) => void; reject: (e: Error) => void; onProgress: (b: number, t: number) => void };
const waiters = new Map<string, Waiter & { needsResolve?: boolean }>();
let nativeWired = false;

function wireNative(): void {
  if (nativeWired) return;
  nativeWired = true;
  StreamProxy.addListener('onDownloadProgress', (e) => waiters.get(e.id)?.onProgress(e.bytes, e.total));
  StreamProxy.addListener('onDownloadDone', (e) => settle(e.id, { bytes: e.bytes }));
  StreamProxy.addListener('onDownloadFailed', (e) => settle(e.id, undefined, Object.assign(new Error(e.reason), { needsResolve: e.needsResolve })));
  // Events are not delivered while iOS has the app suspended: reconcile with the native state when it wakes up.
  AppState.addEventListener('change', (st) => {
    if (st !== 'active') return;
    for (const d of StreamProxy.bgDownloadStatus()) {
      if (!waiters.has(d.id)) continue;
      if (d.state === 'done') settle(d.id, { bytes: d.total });
      else if (d.state === 'failed') settle(d.id, undefined, Object.assign(new Error(d.error ?? 'failed'), { needsResolve: !!d.needsResolve }));
      else waiters.get(d.id)?.onProgress(d.bytes, d.total);
    }
  });
}

function settle(id: string, ok?: { bytes: number }, err?: Error): void {
  const w = waiters.get(id);
  if (!w) return;
  waiters.delete(id);
  if (ok) {
    saveArtwork(id);
    log('downloads', `done ${id} ${ok.bytes}B`);
    w.resolve(ok);
  } else w.reject(err!);
}

/**
 * The byte transfer runs in a background URLSession inside the stream-proxy module (so it continues while the app is
 * suspended). JS resolves the upstream URL, hands it over, and re-resolves when the native side reports an expired URL.
 */
async function runDownload(id: string, onProgress: (bytes: number, total: number) => void): Promise<{ bytes: number }> {
  dir().create({ intermediates: true, idempotent: true });
  wireNative();
  const dest = audioFile(id);
  if (dest.exists && (dest.size ?? 0) > 0) return { bytes: dest.size ?? 0 };
  // A song the player already downloaded completely into the proxy's cache is kept offline by copying that file.
  const cached = keepCachedCopy(id, dest);
  if (cached) return { bytes: cached };
  for (let attempt = 0; ; attempt++) {
    const s = await resolver.resolve(id, { fresh: attempt > 0 });
    if (!s.contentLength) throw new Error('unknown length');
    checkSpace(s.contentLength);
    try {
      return await new Promise<{ bytes: number }>((resolve, reject) => {
        waiters.set(id, { resolve, reject, onProgress });
        StreamProxy.bgDownloadStart(id, { url: s.url, headers: s.headers, userAgent: s.userAgent, total: s.contentLength, partPath: stripFile(partFile(id).uri), destPath: stripFile(dest.uri) });
      });
    } catch (e) {
      if ((e as { needsResolve?: boolean }).needsResolve && attempt < 2) {
        log('downloads', `${id} URL expired, re-resolving`);
        continue;
      }
      throw e;
    }
  }
}

/** Copies the proxy's fully cached copy of `id` to `dest` (the cache is trimmed, downloads are kept). Returns the byte count, or 0 when there is none. */
function keepCachedCopy(id: string, dest: File): number {
  try {
    const hit = StreamProxy.cacheLookup?.(id);
    if (!hit?.bytes) return 0;
    const src = new File(`file://${hit.path}`);
    if (!src.exists) return 0;
    src.copy(dest);
    log('downloads', `kept ${id} from the playback cache (${hit.bytes}B, no download)`);
    return hit.bytes;
  } catch (e) {
    logWarn('downloads', `cached copy of ${id} failed`, e instanceof Error ? e.message : e);
    return 0;
  }
}

function checkSpace(needed: number): void {
  if (Paths.availableDiskSpace < needed + 200 * 1024 * 1024) throw new Error('Not enough free space on this device');
  const limit = gbToBytes(downloadSettings().limitGb);
  if (limit && usedBytes() + needed > limit) {
    enforceLimit(needed);
    if (usedBytes() + needed > limit) throw new Error('Storage limit reached');
  }
}

/**
 * Artwork is saved next to the audio (CarPlay / offline). Albums share one image across tracks, and concurrent
 * downloads of the same URL collide in expo-file-system's temp file, so they run one at a time and an image already
 * saved for the same URL is copied instead of fetched again.
 */
let artChain: Promise<void> = Promise.resolve();
const artByUrl = new Map<string, File>();
function saveArtwork(id: string): void {
  artChain = artChain.then(() => doSaveArtwork(id)).catch(() => {});
}
async function doSaveArtwork(id: string): Promise<void> {
  const t = pending.get(id) ?? repo.getTracks(getDb(), [id]).get(id);
  const url = t ? pickArtwork(t.artwork, 544) : undefined;
  if (!url || !dir().exists) return;
  try {
    const f = artFile(id);
    if (f.exists) f.delete();
    const have = artByUrl.get(url);
    if (have?.exists) have.copy(f);
    else {
      await File.downloadFileAsync(url, f);
      artByUrl.set(url, f);
    }
  } catch (e) {
    logWarn('downloads', `artwork ${id} failed: ${e instanceof Error ? e.message : e}`);
  }
}

export const usedBytes = () => Object.values(useDownloads.getState().byId).reduce((n, r) => n + (r.state === 'done' ? r.bytes : 0), 0);

function enforceLimit(extra = 0): void {
  const limit = gbToBytes(downloadSettings().limitGb);
  if (!limit) return;
  const rows = Object.values(useDownloads.getState().byId).filter((r) => r.state === 'done');
  const victims = planEviction(
    rows.map((r) => ({ trackId: r.trackId, bytes: r.bytes, pinned: !!r.pinned, lastPlayedAt: r.lastPlayedAt, updatedAt: r.updatedAt })),
    Math.max(0, limit - extra),
    protectedIds(),
  );
  victims.forEach(deleteFiles);
  if (victims.length) {
    victims.forEach((id) => repo.deleteDownload(getDb(), id));
    refresh();
    log('downloads', `LRU evicted ${victims.length}`);
  }
}

const protectedIds = (): Set<string> => {
  // Imported lazily: player/queue imports this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate cycle break, see above
  const { playerState } = require('../player/store') as typeof import('../player/store');
  const s = playerState();
  return new Set(s.queue.slice(Math.max(0, s.index), s.index + 3).map((t) => t.id));
};

function deleteFiles(id: string): void {
  try {
    StreamProxy.bgDownloadCancel(id);
  } catch {
    /* native module unavailable (tests) */
  }
  waiters.delete(id);
  for (const f of [audioFile(id), partFile(id), new File(dir(), `${id}.m4a.part.bg.json`), artFile(id)]) {
    try {
      if (f.exists) f.delete();
    } catch {
      /* best effort */
    }
  }
}

function gate(): string | undefined {
  if (isOffline()) return 'offline';
  if (downloadSettings().wifiOnly && !useNet.getState().wifi) return 'Waiting for Wi-Fi';
  return undefined;
}

/** Opens the DB state, resumes interrupted jobs and wires network / settings / auto-download reactions. */
export function startDownloads(): void {
  if (queue) return;
  initLibrary();
  queue = new DownloadQueue({ runner: runDownload, onChange: persist, onProgress: uiProgress, gate });
  for (const r of repo.allDownloads(getDb())) {
    if (r.state === 'done') {
      if (!audioFile(r.trackId).exists) repo.deleteDownload(getDb(), r.trackId); // file vanished (e.g. restored backup)
      continue;
    }
    queue.restore({ id: r.trackId, state: 'queued', attempts: r.state === 'failed' ? r.attempts : 0, bytes: r.bytes, total: r.totalBytes, error: r.error ?? undefined });
  }
  refresh();
  onNetChange(() => queue?.pump());
  useDownloadSettings.subscribe((s, p) => {
    if (s.wifiOnly !== p.wifiOnly) queue?.pump();
    if (s.limitGb !== p.limitGb) enforceLimit();
    if (s.autoDownloadLiked && !p.autoDownloadLiked) autoDownloadLiked();
  });
  let lastLiked = useLibraryStore.getState().liked;
  useLibraryStore.subscribe((s) => {
    if (s.liked === lastLiked) return;
    lastLiked = s.liked;
    if (downloadSettings().autoDownloadLiked) autoDownloadLiked();
  });
  if (downloadSettings().autoDownloadLiked) autoDownloadLiked();
}

/** Liked songs are downloaded unpinned, so the storage limit may evict them (LRU). */
function autoDownloadLiked(): void {
  const liked = useLibraryStore.getState().liked;
  downloadTracks(liked, { kind: 'liked', id: 'liked', name: 'Liked Songs' }, { pinned: false });
}

export function downloadTracks(tracks: Track[], group?: GroupInfo, opts: { pinned?: boolean } = {}): number {
  startDownloads();
  tracks = tracks.filter((t) => !isLocalId(t.id)); // songs from this iPhone are already files on it
  const db = getDb();
  repo.upsertTracks(db, tracks);
  let n = 0;
  for (const t of tracks) {
    const cur = useDownloads.getState().byId[t.id];
    if (cur?.state === 'done') {
      if (opts.pinned !== false && !cur.pinned) repo.patchDownload(db, t.id, { pinned: 1 }); // explicit request pins an auto download
      continue;
    }
    if (cur && cur.state !== 'failed') continue;
    pending.set(t.id, t);
    repo.upsertDownload(db, {
      trackId: t.id,
      state: 'queued',
      quality: downloadSettings().quality,
      pinned: opts.pinned === false ? 0 : 1,
      groupKind: group?.kind ?? null,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      attempts: 0,
      error: null,
    });
    queue!.enqueue(t.id, 0);
    n++;
  }
  refresh();
  if (n) log('downloads', `queued ${n} tracks (${group?.name ?? 'single'})`);
  return n;
}

export function retryDownload(id: string): void {
  startDownloads();
  queue!.retry(id);
}

export function removeDownload(id: string): void {
  startDownloads();
  queue!.remove(id);
  deleteFiles(id);
  repo.deleteDownload(getDb(), id);
  refresh();
}

export function removeAllDownloads(): void {
  startDownloads();
  for (const id of Object.keys(useDownloads.getState().byId)) {
    queue!.remove(id);
    repo.deleteDownload(getDb(), id);
  }
  try {
    if (dir().exists) dir().delete();
  } catch (e) {
    logWarn('downloads', 'remove all failed', e instanceof Error ? e.message : e);
  }
  refresh();
}

/** TV: removes downloads an older build made, without starting the download queue when there are none. */
export function clearDownloadsIfAny(): void {
  try {
    if (repo.allDownloads(getDb()).length) removeAllDownloads();
  } catch (e) {
    logWarn('downloads', 'clear failed', e instanceof Error ? e.message : e);
  }
}

// ---- lookups used by the player / UI / CarPlay ----

export const getDownloadRow = (id: string): DownloadRow | undefined => useDownloads.getState().byId[id];
export const isDownloaded = (id: string): boolean => getDownloadRow(id)?.state === 'done';
export const useDownloadRow = (id?: string) => useDownloads((s) => (id ? s.byId[id] : undefined));

/** `file://` URL of the downloaded audio, if the track is downloaded and the file is still there. */
export function localAudioUrl(id: string): string | undefined {
  if (!isDownloaded(id)) return undefined;
  const f = audioFile(id);
  return f.exists ? f.uri : undefined;
}
export function localArtworkUrl(id: string): string | undefined {
  const f = artFile(id);
  return isDownloaded(id) && f.exists ? f.uri : undefined;
}

export function markPlayed(id: string): void {
  if (!isDownloaded(id)) return;
  repo.patchDownload(getDb(), id, { lastPlayedAt: Date.now() });
  useDownloads.setState((s) => ({ byId: { ...s.byId, [id]: { ...s.byId[id], lastPlayedAt: Date.now() } } }));
}

/** Downloaded tracks (newest first) and downloaded groups for the Library / CarPlay. */
export function downloadedTracks(): Track[] {
  startDownloads();
  return repo.downloadedTracks(getDb()).filter((t) => localAudioUrl(t.id));
}

export type DownloadGroup = { kind: string; id: string; name: string; trackIds: string[] };
export function downloadedGroups(): DownloadGroup[] {
  const m = new Map<string, DownloadGroup>();
  for (const r of Object.values(useDownloads.getState().byId)) {
    if (r.state !== 'done' || !r.groupKind || !r.groupId || r.groupKind === 'liked') continue;
    const k = `${r.groupKind}:${r.groupId}`;
    const g = m.get(k) ?? { kind: r.groupKind, id: r.groupId, name: r.groupName ?? 'Downloaded', trackIds: [] };
    g.trackIds.push(r.trackId);
    m.set(k, g);
  }
  return [...m.values()];
}

/** Aggregate progress 0..1 of the given tracks (done = 1), or undefined when none is queued/downloading. */
export function progressOf(tracks: { id: string }[], byId = useDownloads.getState().byId): { fraction: number; active: boolean; done: number; failed: number } {
  let sum = 0;
  let active = false;
  let done = 0;
  let failed = 0;
  for (const t of tracks) {
    const r = byId[t.id];
    if (!r) continue;
    if (r.state === 'done') {
      sum += 1;
      done++;
    }
    else if (r.state === 'failed') failed++;
    else {
      active = true;
      sum += r.totalBytes ? Math.min(0.99, r.bytes / r.totalBytes) : 0;
    }
  }
  return { fraction: tracks.length ? sum / tracks.length : 0, active, done, failed };
}
