import { getDb } from '../db/client';
import * as repo from '../db/repo';
import type { SavedItem } from '../db/repo';
import type { Db } from '../db/types';
import { log } from '../util/log';
import { getJson, setJson } from '../util/storage';
import type { Track } from '../youtube/models';
import { initLibrary, refreshLibrary } from './store';
import { planPart } from './syncPlan';

/** What the account returned. `complete` is per part: false when it failed or had a continuation that was not followed. */
export type RemoteLibrary = {
  liked: Track[];
  playlists: SavedItem[];
  albums: SavedItem[];
  artists: SavedItem[];
  complete: { liked: boolean; playlists: boolean; albums: boolean; artists: boolean };
};

const SNAP_KEY = 'library.ytsync.v1';
type Snapshot = { liked?: string[]; saved?: Partial<Record<'playlist' | 'album' | 'artist', string[]>> };

/** Ids the user toggled while a sync was running (their remote state is not settled yet): the sync neither adds nor removes them. */
const touched = new Set<string>();
export const noteLikeChange = (trackId: string): void => void touched.add(trackId);
export const noteFollowChange = (artistId: string): void => void touched.add(`artist-${artistId}`);
const savedKey = (it: SavedItem) => `${it.kind}-${it.id}`;

/**
 * Applies a fetched library to the local YT-sourced rows. Additive whenever the data is doubtful (see syncPlan); the snapshot of ids seen
 * is written only here, i.e. after a successful apply.
 */
export function applyYtLibrary(lib: RemoteLibrary, db: Db = getDb(), store = { read: () => getJson<Snapshot>(SNAP_KEY) ?? {}, write: (s: Snapshot) => setJson(SNAP_KEY, s) }): { removed: number; skipped: string[] } {
  const snap = store.read();
  const next: Snapshot = { saved: { ...(snap.saved ?? {}) } };
  const skipped: string[] = [];
  let removed = 0;

  const liked = lib.liked.filter((t) => !touched.has(t.id));
  const lp = planPart({ remote: lib.liked.map((t) => t.id), complete: lib.complete.liked, localYt: repo.ytLikedIds(db), snapshot: snap.liked, touched });
  repo.applyYtLiked(db, liked, lp.remove);
  next.liked = lp.snapshot;
  removed += lp.remove.length;
  if (lp.skipped) skipped.push(`liked:${lp.skipped}`);

  const localSaved = repo.ytSavedKeys(db);
  const parts: ['playlist' | 'album' | 'artist', SavedItem[], boolean][] = [
    ['playlist', lib.playlists, lib.complete.playlists],
    ['album', lib.albums, lib.complete.albums],
    ['artist', lib.artists, lib.complete.artists],
  ];
  const items: SavedItem[] = [];
  const remove: string[] = [];
  for (const [kind, list, complete] of parts) {
    const prefix = `${kind}-`;
    const pp = planPart({
      remote: list.map(savedKey),
      complete,
      localYt: localSaved.filter((k) => k.startsWith(prefix)),
      snapshot: snap.saved?.[kind],
      touched,
    });
    items.push(...list.filter((it) => !touched.has(savedKey(it))));
    remove.push(...pp.remove);
    next.saved![kind] = pp.snapshot;
    removed += pp.remove.length;
    if (pp.skipped) skipped.push(`${kind}:${pp.skipped}`);
  }
  repo.applyYtSaved(db, items, remove);
  store.write(next);
  touched.clear();
  initLibrary();
  refreshLibrary();
  if (skipped.length) log('library', `sync kept local items (${skipped.join(', ')})`);
  return { removed, skipped };
}

export const resetTouched = (): void => touched.clear();

/** Sign-out: the ids seen belong to the account that left. */
export const resetSnapshot = (): void => setJson(SNAP_KEY, {});
