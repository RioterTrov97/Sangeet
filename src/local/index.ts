import { Directory, File, Paths } from 'expo-file-system';
import { useMemo } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import StreamProxy from '../../modules/stream-proxy';
import { log, logWarn } from '../util/log';
import { getJson, setJson } from '../util/storage';
import type { Track } from '../youtube/models';
import { fileUriIn, isAudioFileName, isHiddenName, rebaseArtUri, resolveMeta, uniqueName } from './names';
import { planScan, type DiskFile } from './plan';
import { byAddedDesc, toTrack, type LocalSong } from './track';

export { isLocalId } from './id';
export type { LocalSong } from './track';

/**
 * Songs from this iPhone. `Documents/Music` is the single source of truth: files picked from Files are copied there, and the
 * folder shows in the Files app (On My iPhone > Sangeet > Music; UIFileSharingEnabled) and in Finder over USB, so anything dropped
 * there is found by `scanLocalSongs` (at launch and whenever the app becomes active). The index below (title, artist, artwork,
 * ...) is only a cache of what the scan read; a file that disappears drops out of it.
 */

const KEY = 'local.songs.v1';
type Index = Record<string, LocalSong>;

export const useLocalSongs = create<{ songs: Index }>(() => ({ songs: getJson<Index>(KEY) ?? {} }));
const songs = (): Index => useLocalSongs.getState().songs;

const musicDir = () => new Directory(Paths.document, 'Music');
/** A dot folder: Documents is visible in Files, and hidden names are not listed there. */
const artDir = () => new Directory(Paths.document, '.music-art');
const stripFile = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** Never `new File(musicDir(), name)` for a user's file name: see fileUriIn. */
const fileOf = (rel: string) => new File(fileUriIn(musicDir().uri, rel));

/** Creates Documents/Music (and the hidden art folder) so the Sangeet folder shows in Files from the first launch. */
export function ensureMusicFolder(): void {
  try {
    musicDir().create({ intermediates: true, idempotent: true });
    artDir().create({ intermediates: true, idempotent: true });
  } catch (e) {
    logWarn('local', 'could not create the music folder', e instanceof Error ? e.message : e);
  }
}

// ---- lookups ----

/** `file://` uri of the song's audio, or undefined for an unknown id. */
export function localSongUrl(id: string): string | undefined {
  const s = songs()[id];
  return s ? fileOf(s.rel).uri : undefined;
}

/** `file://` uri of the song's embedded artwork, if it had any. */
export function localSongArt(id: string): string | undefined {
  const art = songs()[id]?.art;
  return art ? new File(artDir(), art).uri : undefined;
}

/** A saved `file://` artwork url (library, queue, history) pointed at the current container; other urls pass through. */
export const rebaseLocalArt = (url: string): string => (url.startsWith('file://') ? rebaseArtUri(url, artDir().uri) : url);

/** The `.lrc` file with the same base name next to the song, if any. Read each time (cheap); never cached. */
export function localLrcText(id: string): string | undefined {
  const s = songs()[id];
  if (!s) return undefined;
  try {
    const f = fileOf(s.rel.replace(/\.[^./]+$/, '.lrc'));
    return f.exists ? f.textSync() : undefined;
  } catch {
    return undefined;
  }
}

const asTrack = (s: LocalSong): Track => toTrack(s, localSongArt(s.id));
const sorted = (idx: Index): LocalSong[] => Object.values(idx).sort(byAddedDesc);

/** The songs from this iPhone, newest first. */
export const localTracks = (): Track[] => sorted(songs()).map(asTrack);
export function useLocalTracks(): Track[] {
  const idx = useLocalSongs((s) => s.songs);
  return useMemo(() => sorted(idx).map(asTrack), [idx]);
}
export const useLocalCount = (): number => useLocalSongs((s) => Object.keys(s.songs).length);

// ---- scanning ----

function listDisk(dir: Directory, prefix = ''): DiskFile[] {
  const out: DiskFile[] = [];
  let entries: (Directory | File)[];
  try {
    entries = dir.list();
  } catch {
    return out;
  }
  for (const e of entries) {
    const name = e.name;
    if (isHiddenName(name)) continue;
    if (e instanceof Directory) out.push(...listDisk(e, `${prefix}${name}/`));
    else if (isAudioFileName(name)) out.push({ rel: `${prefix}${name}`, size: e.size ?? 0, mtime: e.modificationTime ?? 0 });
  }
  return out;
}

const artName = (id: string, mtime: number) => `${id}-${mtime}.jpg`;

function dropArt(name: string | undefined): void {
  if (!name) return;
  try {
    const f = new File(artDir(), name);
    if (f.exists) f.delete();
  } catch {}
}

async function readOne(d: DiskFile & { id: string }): Promise<{ tags: Awaited<ReturnType<typeof StreamProxy.readAudioTags>>; art?: string }> {
  const art = artName(d.id, d.mtime);
  try {
    const tags = await StreamProxy.readAudioTags(stripFile(fileOf(d.rel).uri), stripFile(new File(artDir(), art).uri));
    return { tags, art: tags.hasArtwork ? art : undefined };
  } catch (e) {
    logWarn('local', `could not read tags of ${d.rel}`, e instanceof Error ? e.message : e);
    return { tags: { hasArtwork: false } };
  }
}

export type ScanResult = { added: number; changed: number; removed: number };

let scanning: Promise<ScanResult> | undefined;
let rescan = false;

/**
 * Brings the index in line with Documents/Music: new or changed files (size / modification time) are read, files that are gone
 * are dropped with their artwork. One scan at a time (a request during a scan runs once more afterwards); cheap when nothing changed.
 */
export function scanLocalSongs(): Promise<ScanResult> {
  if (scanning) {
    rescan = true;
    return scanning;
  }
  scanning = (async () => {
    const total: ScanResult = { added: 0, changed: 0, removed: 0 };
    try {
      do {
        rescan = false;
        const r = await scanOnce();
        total.added += r.added;
        total.changed += r.changed;
        total.removed += r.removed;
      } while (rescan);
    } catch (e) {
      logWarn('local', 'scan failed', e instanceof Error ? e.message : e);
    }
    return total;
  })().finally(() => (scanning = undefined));
  return scanning;
}

async function scanOnce(): Promise<ScanResult> {
  ensureMusicFolder();
  const plan = planScan(songs(), listDisk(musicDir()));
  if (!plan.read.length && !plan.remove.length) return { added: 0, changed: 0, removed: 0 };
  let next: Index = { ...songs() };
  for (const id of plan.remove) {
    dropArt(next[id]?.art);
    delete next[id];
  }
  if (plan.remove.length) commit(next);
  let added = 0;
  let changed = 0;
  let sinceCommit = 0;
  for (const d of plan.read) {
    const { tags, art } = await readOne(d);
    const old = next[d.id];
    if (old?.art && old.art !== art) dropArt(old.art);
    const name = d.rel.slice(d.rel.lastIndexOf('/') + 1);
    next = { ...next, [d.id]: { id: d.id, rel: d.rel, size: d.size, mtime: d.mtime, ...resolveMeta(tags, name), art, addedAt: old?.addedAt ?? Date.now() } };
    if (d.isNew) added++;
    else changed++;
    // Show a big first import as it goes (and keep what was read if the app is killed part way).
    if (++sinceCommit >= 20) {
      commit(next);
      sinceCommit = 0;
    }
  }
  commit(next);
  sweepArt();
  log('local', `scan: ${added} added, ${changed} changed, ${plan.remove.length} removed`);
  return { added, changed, removed: plan.remove.length };
}

function commit(idx: Index): void {
  useLocalSongs.setState({ songs: idx });
  setJson(KEY, idx);
}

/** Artwork no song points at (a re-read of a changed file, a crash part way) is deleted. */
function sweepArt(): void {
  try {
    const keep = new Set(Object.values(songs()).map((s) => s.art));
    const d = artDir();
    if (!d.exists) return;
    for (const f of d.list()) if (f instanceof File && !keep.has(f.name)) f.delete();
  } catch (e) {
    logWarn('local', 'artwork sweep failed', e instanceof Error ? e.message : e);
  }
}

// ---- importing and deleting ----

export type PickedFile = { name: string; uri: string };

/**
 * Copies picked files into Documents/Music (their own name; "Name (2).ext" when that name is taken), then scans.
 * Returns how many songs were added and how many picked files were not audio the app plays.
 */
export async function importFiles(picked: readonly PickedFile[]): Promise<{ added: number; skipped: number }> {
  ensureMusicFolder();
  const taken = new Set<string>();
  try {
    for (const e of musicDir().list()) taken.add(e.name);
  } catch {}
  let skipped = 0;
  for (const p of picked) {
    if (!isAudioFileName(p.name)) {
      skipped++;
      continue;
    }
    const name = uniqueName(p.name, taken);
    taken.add(name);
    try {
      const from = new File(p.uri);
      const to = fileOf(name);
      try {
        // A picked file is already a temporary copy in the cache (copyToCacheDirectory), so moving it saves a second copy.
        from.move(to);
      } catch (e) {
        logWarn('local', `move of ${p.name} failed, copying`, e instanceof Error ? e.message : e);
        from.copy(to);
      }
      log('local', `imported ${p.name} as ${name}`);
    } catch (e) {
      skipped++;
      logWarn('local', `could not import ${p.name} (${p.uri})`, e instanceof Error ? e.message : e);
    }
  }
  const r = await scanLocalSongs();
  return { added: r.added, skipped };
}

/** Deletes the song's file, artwork and index entry. A queue still holding it fails that song like any other. */
export function deleteLocalSong(id: string): void {
  const s = songs()[id];
  if (!s) return;
  try {
    const f = fileOf(s.rel);
    if (f.exists) f.delete();
  } catch (e) {
    logWarn('local', `could not delete ${s.rel}`, e instanceof Error ? e.message : e);
  }
  dropArt(s.art);
  const next = { ...songs() };
  delete next[id];
  commit(next);
}

// ---- start-up ----

let started = false;
/** Creates the folder and scans now and whenever the app becomes active (files may have been dropped in from Files or Finder meanwhile). */
export function startLocalSongs(): void {
  if (started) return;
  started = true;
  ensureMusicFolder();
  void scanLocalSongs();
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void scanLocalSongs();
  });
}
