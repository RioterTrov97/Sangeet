import { create } from 'zustand';

import { getDb } from '../db/client';
import { migrateFromMmkv } from '../db/mmkvMigration';
import * as repo from '../db/repo';
import type { LocalPlaylist, SavedItem } from '../db/repo';
import { log, logWarn } from '../util/log';
import { getJson, storage } from '../util/storage';
import type { Artist, MusicItem, Track } from '../youtube/models';

export type { SavedItem, LocalPlaylist };

export type LibraryState = {
  /** Liked tracks, newest first (local + mirrored YouTube Music likes). */
  liked: Track[];
  /** Saved albums / artists / playlists, newest first. */
  saved: SavedItem[];
  /** Local playlists, last-updated first. */
  playlists: LocalPlaylist[];
  /** `kind-id` of saved items mirrored from YouTube Music (shown under "From YouTube Music"). */
  ytKeys: string[];
  /** `kind-id` -> save time (ms) of saved items. */
  savedAt: Record<string, number>;
  /** Bumped on every playlist-content change so track lists re-read. */
  playlistsRev: number;
};

/** Pure helpers so the ordering/toggle rules stay unit-testable. */
export function toggleTrack(list: Track[], track: Track): Track[] {
  return list.some((t) => t.id === track.id) ? list.filter((t) => t.id !== track.id) : [track, ...list];
}
export function toggleSavedItem(list: SavedItem[], item: SavedItem): SavedItem[] {
  const same = (x: SavedItem) => x.kind === item.kind && x.id === item.id;
  return list.some(same) ? list.filter((x) => !same(x)) : [item, ...list];
}

export const useLibraryStore = create<LibraryState>(() => ({ liked: [], saved: [], playlists: [], ytKeys: [], savedAt: {}, playlistsRev: 0 }));
export const libraryState = () => useLibraryStore.getState();

let ready = false;
/** Opens + migrates the database, imports the old MMKV library once, and hydrates the store. Synchronous and idempotent. */
export function initLibrary(): void {
  if (ready) return;
  ready = true;
  try {
    const db = getDb();
    const moved = migrateFromMmkv(db, {
      get: (k) => getJson(k),
      remove: (k) => void storage.remove(k),
    });
    if (moved.liked || moved.saved || moved.history) log('library', `migrated from MMKV: ${JSON.stringify(moved)}`);
    refreshLibrary();
  } catch (e) {
    ready = false;
    logWarn('library', 'init failed', e instanceof Error ? e.message : e);
  }
}

export function refreshLibrary(): void {
  const db = getDb();
  useLibraryStore.setState((s) => ({ liked: repo.likedTracks(db), saved: repo.savedItems(db), playlists: repo.listPlaylists(db), ytKeys: repo.ytSavedKeys(db), savedAt: repo.savedAtMap(db), playlistsRev: s.playlistsRev + 1 }));
}

type LikeSync = (track: Track, on: boolean) => Promise<void>;
let likeSync: LikeSync | undefined;
/** The auth module registers how a like is mirrored to YouTube Music (kept out of this module to avoid an import cycle). */
export const setLikeSync = (fn: LikeSync | undefined) => void (likeSync = fn);

export function toggleLike(track: Track): boolean {
  initLibrary();
  const db = getDb();
  const on = !isLiked(track.id);
  repo.setLiked(db, track, on, 'local');
  refreshLibrary();
  if (likeSync) {
    // Optimistic: the local change stays unless the mirrored call fails, then roll back.
    likeSync(track, on).catch((e) => {
      logWarn('library', `YT like sync failed, rolling back: ${e instanceof Error ? e.message : e}`);
      repo.setLiked(db, track, !on, 'local');
      refreshLibrary();
    });
  }
  return on;
}

type FollowSync = (artist: Artist, on: boolean) => Promise<void>;
let followSync: FollowSync | undefined;
/** The auth module registers how a follow is mirrored to YouTube Music (subscribe / unsubscribe). */
export const setFollowSync = (fn: FollowSync | undefined) => void (followSync = fn);

/** Follows / unfollows an artist locally (saved_collections, kind artist). Optimistic; the signed-in YouTube sync rolls back on error. */
export function toggleFollow(artist: Artist): boolean {
  initLibrary();
  const db = getDb();
  const on = !isFollowing(artist.id);
  repo.setSaved(db, artist, on, 'local');
  refreshLibrary();
  if (followSync) {
    followSync(artist, on).catch((e) => {
      logWarn('library', `YT subscribe sync failed, rolling back: ${e instanceof Error ? e.message : e}`);
      repo.setSaved(db, artist, !on, 'local');
      refreshLibrary();
    });
  }
  return on;
}

/** Followed artists, newest first. */
export const followedArtists = (): Artist[] => useLibraryStore.getState().saved.filter((x): x is Artist => x.kind === 'artist');
export const isFollowing = (id: string) => useLibraryStore.getState().saved.some((x) => x.kind === 'artist' && x.id === id);
export const useIsFollowing = (id?: string) => useLibraryStore((s) => (id ? s.saved.some((x) => x.kind === 'artist' && x.id === id) : false));

export function toggleSaved(item: SavedItem): void {
  initLibrary();
  repo.setSaved(getDb(), item, !useLibraryStore.getState().saved.some((x) => x.kind === item.kind && x.id === item.id));
  refreshLibrary();
}

export const isLiked = (id: string) => useLibraryStore.getState().liked.some((t) => t.id === id);

export const useIsLiked = (id?: string) => useLibraryStore((s) => (id ? s.liked.some((t) => t.id === id) : false));
export const useIsSaved = (kind: MusicItem['kind'], id?: string) => useLibraryStore((s) => (id ? s.saved.some((x) => x.kind === kind && x.id === id) : false));

// ---- local playlists ----

export function createLocalPlaylist(name: string, tracks: Track[] = []): string {
  initLibrary();
  const db = getDb();
  const id = repo.createPlaylist(db, name);
  if (tracks.length) repo.addToPlaylist(db, id, tracks);
  refreshLibrary();
  return id;
}
export function renameLocalPlaylist(id: string, name: string): void {
  repo.renamePlaylist(getDb(), id, name);
  refreshLibrary();
}
export function deleteLocalPlaylist(id: string): void {
  repo.deletePlaylist(getDb(), id);
  refreshLibrary();
}
export function addToLocalPlaylist(id: string, tracks: Track[]): number {
  const n = repo.addToPlaylist(getDb(), id, tracks);
  refreshLibrary();
  return n;
}
export function removeFromLocalPlaylist(id: string, trackId: string): void {
  repo.removeFromPlaylist(getDb(), id, trackId);
  refreshLibrary();
}
export function reorderLocalPlaylist(id: string, from: number, to: number): void {
  repo.reorderPlaylist(getDb(), id, from, to);
  refreshLibrary();
}
export function sortLocalPlaylist(id: string, by: 'title' | 'artist'): void {
  const db = getDb();
  const tracks = repo.playlistTracks(db, id);
  const key = (t: Track) => (by === 'title' ? t.title : (t.artists[0]?.name ?? '')).toLowerCase();
  const ordered = [...tracks].sort((a, b) => key(a).localeCompare(key(b)));
  repo.setPlaylistOrder(db, id, ordered.map((t) => t.id));
  refreshLibrary();
}
export const lastPlayedBySource = (): Record<string, number> => repo.lastPlayedBySource(getDb());
export const localPlaylistTracks = (id: string): Track[] => repo.playlistTracks(getDb(), id);
