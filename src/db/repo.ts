import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Album, Artist, Artwork, Playlist, Track } from '../youtube/models';
import * as t from './schema';
import type { Db } from './types';

export type SavedItem = Album | Artist | Playlist;
export type Source = 'local' | 'yt';

const now = () => Date.now();
const parse = <T>(json: string): T => JSON.parse(json) as T;

// ---- tracks cache ----

export function upsertTracks(db: Db, list: Track[]): void {
  for (const tr of list) {
    db.insert(t.tracks)
      .values({ id: tr.id, json: JSON.stringify(tr), updatedAt: now() })
      .onConflictDoUpdate({ target: t.tracks.id, set: { json: JSON.stringify(tr), updatedAt: now() } })
      .run();
  }
}

export function getTracks(db: Db, ids: string[]): Map<string, Track> {
  const out = new Map<string, Track>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db.select().from(t.tracks).where(inArray(t.tracks.id, ids.slice(i, i + 500))).all()) out.set(r.id, parse<Track>(r.json));
  }
  return out;
}

// ---- liked ----

/** Newest first. */
export function likedTracks(db: Db): Track[] {
  const rows = db.select({ json: t.tracks.json }).from(t.liked).innerJoin(t.tracks, eq(t.tracks.id, t.liked.trackId)).orderBy(desc(t.liked.likedAt)).all();
  return rows.map((r) => parse<Track>(r.json));
}

export function setLiked(db: Db, track: Track, on: boolean, source: Source = 'local', at = now()): void {
  if (on) {
    upsertTracks(db, [track]);
    db.insert(t.liked).values({ trackId: track.id, likedAt: at, source }).onConflictDoNothing().run();
  } else {
    db.delete(t.liked).where(eq(t.liked.trackId, track.id)).run();
  }
}

/** Replaces the YT-sourced liked rows (keeps local ones). `list` is newest first. */
export function replaceYtLiked(db: Db, list: Track[]): void {
  db.delete(t.liked).where(eq(t.liked.source, 'yt')).run();
  upsertTracks(db, list);
  const at = now();
  list.forEach((tr, i) => db.insert(t.liked).values({ trackId: tr.id, likedAt: at - i - 1, source: 'yt' }).onConflictDoNothing().run());
}

/** Ids of the YT-sourced liked rows. */
export function ytLikedIds(db: Db): string[] {
  return db.select({ id: t.liked.trackId }).from(t.liked).where(eq(t.liked.source, 'yt')).all().map((r) => r.id);
}

/**
 * Non-destructive counterpart of replaceYtLiked: makes sure every track of `list` (newest first) has a liked row, refreshes the order of the
 * YT-sourced ones, and deletes only the YT-sourced rows named in `removeIds`. Local rows are never touched.
 */
export function applyYtLiked(db: Db, list: Track[], removeIds: string[]): void {
  upsertTracks(db, list);
  const at = now();
  list.forEach((tr, i) => {
    db.insert(t.liked).values({ trackId: tr.id, likedAt: at - i - 1, source: 'yt' }).onConflictDoNothing().run();
    db.update(t.liked).set({ likedAt: at - i - 1 }).where(and(eq(t.liked.trackId, tr.id), eq(t.liked.source, 'yt'))).run();
  });
  if (removeIds.length) db.delete(t.liked).where(and(eq(t.liked.source, 'yt'), inArray(t.liked.trackId, removeIds))).run();
}

// ---- saved collections ----

export function savedItems(db: Db): SavedItem[] {
  return db.select().from(t.savedCollections).orderBy(desc(t.savedCollections.savedAt)).all().map((r) => parse<SavedItem>(r.json));
}

/** Followed artists (saved_collections, kind artist), newest first: local follows plus subscriptions mirrored from YouTube Music. */
export function followedArtists(db: Db): Artist[] {
  return db.select().from(t.savedCollections).where(eq(t.savedCollections.kind, 'artist')).orderBy(desc(t.savedCollections.savedAt)).all().map((r) => parse<Artist>(r.json));
}

export function setSaved(db: Db, item: SavedItem, on: boolean, source: Source = 'local', at = now()): void {
  if (on) {
    db.insert(t.savedCollections).values({ kind: item.kind, id: item.id, json: JSON.stringify(item), savedAt: at, source }).onConflictDoNothing().run();
  } else {
    db.delete(t.savedCollections).where(and(eq(t.savedCollections.kind, item.kind), eq(t.savedCollections.id, item.id))).run();
  }
}

/** `kind-id` -> when it was saved (ms), for the Library's "Recently added" sort. */
export function savedAtMap(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.select({ kind: t.savedCollections.kind, id: t.savedCollections.id, at: t.savedCollections.savedAt }).from(t.savedCollections).all()) out[`${r.kind}-${r.id}`] = r.at;
  return out;
}

/** `kind-id` keys of saved collections that came from the signed-in YouTube Music account. */
export function ytSavedKeys(db: Db): string[] {
  return db.select({ kind: t.savedCollections.kind, id: t.savedCollections.id }).from(t.savedCollections).where(eq(t.savedCollections.source, 'yt')).all().map((r) => `${r.kind}-${r.id}`);
}

export function replaceYtSaved(db: Db, list: SavedItem[]): void {
  db.delete(t.savedCollections).where(eq(t.savedCollections.source, 'yt')).run();
  const at = now();
  list.forEach((it, i) => setSaved(db, it, true, 'yt', at - i - 1));
}

/** Saved-collection counterpart of applyYtLiked: `removeKeys` are `kind-id` strings of YT-sourced rows. */
export function applyYtSaved(db: Db, list: SavedItem[], removeKeys: string[]): void {
  const at = now();
  list.forEach((it, i) => {
    setSaved(db, it, true, 'yt', at - i - 1);
    db.update(t.savedCollections).set({ savedAt: at - i - 1 }).where(and(eq(t.savedCollections.kind, it.kind), eq(t.savedCollections.id, it.id), eq(t.savedCollections.source, 'yt'))).run();
  });
  const gone = new Set(removeKeys);
  for (const r of db.select({ kind: t.savedCollections.kind, id: t.savedCollections.id }).from(t.savedCollections).where(eq(t.savedCollections.source, 'yt')).all()) {
    if (gone.has(`${r.kind}-${r.id}`)) db.delete(t.savedCollections).where(and(eq(t.savedCollections.kind, r.kind), eq(t.savedCollections.id, r.id))).run();
  }
}

export function clearYtRows(db: Db): void {
  db.delete(t.liked).where(eq(t.liked.source, 'yt')).run();
  db.delete(t.savedCollections).where(eq(t.savedCollections.source, 'yt')).run();
}

// ---- local playlists ----

export type LocalPlaylist = { id: string; name: string; count: number; art: Artwork[][]; updatedAt: number; createdAt: number };

const uid = () => `lp_${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createPlaylist(db: Db, name: string): string {
  const id = uid();
  db.insert(t.localPlaylists).values({ id, name: name.trim() || 'New playlist', createdAt: now(), updatedAt: now() }).run();
  return id;
}

export function renamePlaylist(db: Db, id: string, name: string): void {
  db.update(t.localPlaylists).set({ name: name.trim() || 'Untitled', updatedAt: now() }).where(eq(t.localPlaylists.id, id)).run();
}

export function deletePlaylist(db: Db, id: string): void {
  db.delete(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).run();
  db.delete(t.localPlaylists).where(eq(t.localPlaylists.id, id)).run();
}

export function addToPlaylist(db: Db, id: string, list: Track[]): number {
  upsertTracks(db, list);
  const have = new Set(db.select({ id: t.localPlaylistTracks.trackId }).from(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).all().map((r) => r.id));
  let pos = Number(db.select({ m: sql<number>`coalesce(max(${t.localPlaylistTracks.position}), -1)` }).from(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).get()?.m ?? -1) + 1;
  let added = 0;
  for (const tr of list) {
    if (have.has(tr.id)) continue;
    have.add(tr.id);
    db.insert(t.localPlaylistTracks).values({ playlistId: id, trackId: tr.id, position: pos++, addedAt: now() }).run();
    added++;
  }
  if (added) db.update(t.localPlaylists).set({ updatedAt: now() }).where(eq(t.localPlaylists.id, id)).run();
  return added;
}

export function removeFromPlaylist(db: Db, id: string, trackId: string): void {
  db.delete(t.localPlaylistTracks).where(and(eq(t.localPlaylistTracks.playlistId, id), eq(t.localPlaylistTracks.trackId, trackId))).run();
  compactPlaylist(db, id);
}

/** Rewrites positions as 0..n-1 in the current order. */
function compactPlaylist(db: Db, id: string): void {
  const rows = db.select({ trackId: t.localPlaylistTracks.trackId }).from(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).orderBy(asc(t.localPlaylistTracks.position)).all();
  rows.forEach((r, i) => db.update(t.localPlaylistTracks).set({ position: i }).where(and(eq(t.localPlaylistTracks.playlistId, id), eq(t.localPlaylistTracks.trackId, r.trackId))).run());
}

export function reorderPlaylist(db: Db, id: string, from: number, to: number): void {
  const rows = db.select({ trackId: t.localPlaylistTracks.trackId }).from(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).orderBy(asc(t.localPlaylistTracks.position)).all();
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) return;
  const [m] = rows.splice(from, 1);
  rows.splice(to, 0, m);
  rows.forEach((r, i) => db.update(t.localPlaylistTracks).set({ position: i }).where(and(eq(t.localPlaylistTracks.playlistId, id), eq(t.localPlaylistTracks.trackId, r.trackId))).run());
  db.update(t.localPlaylists).set({ updatedAt: now() }).where(eq(t.localPlaylists.id, id)).run();
}

/** Rewrites the playlist's order to `trackIds` (ids not listed keep their relative order at the end). */
export function setPlaylistOrder(db: Db, id: string, trackIds: string[]): void {
  const cur = db.select({ trackId: t.localPlaylistTracks.trackId }).from(t.localPlaylistTracks).where(eq(t.localPlaylistTracks.playlistId, id)).orderBy(asc(t.localPlaylistTracks.position)).all().map((r) => r.trackId);
  const wanted = new Set(cur);
  const order = [...trackIds.filter((x) => wanted.has(x)), ...cur.filter((x) => !trackIds.includes(x))];
  order.forEach((trackId, i) => db.update(t.localPlaylistTracks).set({ position: i }).where(and(eq(t.localPlaylistTracks.playlistId, id), eq(t.localPlaylistTracks.trackId, trackId))).run());
}

export function playlistTracks(db: Db, id: string): Track[] {
  return db
    .select({ json: t.tracks.json })
    .from(t.localPlaylistTracks)
    .innerJoin(t.tracks, eq(t.tracks.id, t.localPlaylistTracks.trackId))
    .where(eq(t.localPlaylistTracks.playlistId, id))
    .orderBy(asc(t.localPlaylistTracks.position))
    .all()
    .map((r) => parse<Track>(r.json));
}

/** Playlists newest-updated first, with a track count and the artwork of the first 4 tracks (2x2 cover). */
export function listPlaylists(db: Db): LocalPlaylist[] {
  return db
    .select()
    .from(t.localPlaylists)
    .orderBy(desc(t.localPlaylists.updatedAt))
    .all()
    .map((p) => {
      const tr = playlistTracks(db, p.id);
      return { id: p.id, name: p.name, count: tr.length, art: tr.slice(0, 4).map((x) => x.artwork), updatedAt: p.updatedAt, createdAt: p.createdAt };
    });
}

// ---- history ----

export function addHistory(db: Db, track: Track, source?: string, at = now()): void {
  upsertTracks(db, [track]);
  db.insert(t.history).values({ trackId: track.id, playedAt: at, source: source ?? null }).run();
  // Keep the table bounded.
  db.run(sql`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC, id DESC LIMIT 1000)`);
}

/** Most-recent-first unique tracks. */
export function recentHistory(db: Db, limit = 50): Track[] {
  const rows = db
    .select({ trackId: t.history.trackId, last: sql<number>`max(${t.history.playedAt})`.as('last') })
    .from(t.history)
    .groupBy(t.history.trackId)
    .orderBy(desc(sql`last`))
    .limit(limit)
    .all();
  const m = getTracks(db, rows.map((r) => r.trackId));
  return rows.map((r) => m.get(r.trackId)).filter((x): x is Track => !!x);
}

/** Last time anything was played from each source ("album:ID", "playlist:ID", "local:ID", "liked", ...), in ms. */
export function lastPlayedBySource(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = db.select({ source: t.history.source, last: sql<number>`max(${t.history.playedAt})`.as('last') }).from(t.history).groupBy(t.history.source).all();
  for (const r of rows) if (r.source) out[r.source] = Number(r.last);
  return out;
}

/** Play count and last play per track, from the (capped) history table. */
export function playStats(db: Db): Map<string, { count: number; last: number }> {
  const rows = db
    .select({ trackId: t.history.trackId, n: sql<number>`count(*)`.as('n'), last: sql<number>`max(${t.history.playedAt})`.as('last') })
    .from(t.history)
    .groupBy(t.history.trackId)
    .all();
  return new Map(rows.map((r) => [r.trackId, { count: Number(r.n), last: Number(r.last) }]));
}

// ---- downloads ----

export type DownloadRow = typeof t.downloads.$inferSelect;

export function allDownloads(db: Db): DownloadRow[] {
  return db.select().from(t.downloads).all();
}

export function getDownload(db: Db, trackId: string): DownloadRow | undefined {
  return db.select().from(t.downloads).where(eq(t.downloads.trackId, trackId)).get();
}

export function upsertDownload(db: Db, row: Partial<DownloadRow> & { trackId: string; state: DownloadRow['state'] }): void {
  const full = { quality: 'normal', ...row, updatedAt: now() };
  db.insert(t.downloads).values(full).onConflictDoUpdate({ target: t.downloads.trackId, set: full }).run();
}

export function patchDownload(db: Db, trackId: string, patch: Partial<Omit<DownloadRow, 'trackId'>>): void {
  db.update(t.downloads).set({ ...patch, updatedAt: now() }).where(eq(t.downloads.trackId, trackId)).run();
}

export function deleteDownload(db: Db, trackId: string): void {
  db.delete(t.downloads).where(eq(t.downloads.trackId, trackId)).run();
}

export function downloadedTracks(db: Db): Track[] {
  return db
    .select({ json: t.tracks.json })
    .from(t.downloads)
    .innerJoin(t.tracks, eq(t.tracks.id, t.downloads.trackId))
    .where(eq(t.downloads.state, 'done'))
    .orderBy(desc(t.downloads.updatedAt))
    .all()
    .map((r) => parse<Track>(r.json));
}

/** Every play since `since` (oldest first) with its track metadata; rows whose track metadata is missing are skipped. */
export function playsSince(db: Db, since: number): { track: Track; playedAt: number }[] {
  const rows = db.select({ trackId: t.history.trackId, playedAt: t.history.playedAt }).from(t.history).where(sql`${t.history.playedAt} >= ${since}`).orderBy(asc(t.history.playedAt)).all();
  const m = getTracks(db, [...new Set(rows.map((r) => r.trackId))]);
  return rows.flatMap((r) => (m.get(r.trackId) ? [{ track: m.get(r.trackId)!, playedAt: r.playedAt }] : []));
}
