import { migrateFromMmkv } from './mmkvMigration';
import { migrate, MIGRATIONS } from './migrations';
import * as r from './repo';
import { memoryDb } from './testDb';
import type { Album, Playlist, Track } from '../youtube/models';

const tr = (id: string, art = id): Track => ({ kind: 'track', id, title: `T ${id}`, artists: [{ name: 'A' }], artwork: [{ url: `u/${art}` }] });
const album: Album = { kind: 'album', id: 'al', title: 'Al', artists: [], artwork: [] };
const pl: Playlist = { kind: 'playlist', id: 'pl', title: 'Pl', artwork: [] };

describe('migrations', () => {
  it('is idempotent', () => {
    const db = memoryDb();
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(() => migrate(db)).not.toThrow();
  });
});

describe('liked / saved', () => {
  it('orders likes newest first and unlikes', () => {
    const db = memoryDb();
    r.setLiked(db, tr('a'), true, 'local', 1);
    r.setLiked(db, tr('b'), true, 'local', 2);
    expect(r.likedTracks(db).map((x) => x.id)).toEqual(['b', 'a']);
    r.setLiked(db, tr('b'), false);
    expect(r.likedTracks(db).map((x) => x.id)).toEqual(['a']);
  });
  it('replaces only YT-sourced rows and clears them on sign-out', () => {
    const db = memoryDb();
    r.setLiked(db, tr('local'), true, 'local');
    r.replaceYtLiked(db, [tr('y1'), tr('y2')]);
    r.setSaved(db, album, true, 'local');
    r.replaceYtSaved(db, [pl]);
    expect(r.likedTracks(db).map((x) => x.id).sort()).toEqual(['local', 'y1', 'y2']);
    r.replaceYtLiked(db, [tr('y3')]);
    expect(r.likedTracks(db).map((x) => x.id).sort()).toEqual(['local', 'y3']);
    r.clearYtRows(db);
    expect(r.likedTracks(db).map((x) => x.id)).toEqual(['local']);
    expect(r.savedItems(db).map((x) => x.id)).toEqual(['al']);
  });
});

describe('local playlists', () => {
  it('create, add (deduped), reorder, remove, rename, delete', () => {
    const db = memoryDb();
    const id = r.createPlaylist(db, ' Mix ');
    expect(r.addToPlaylist(db, id, [tr('a'), tr('b'), tr('c'), tr('a')])).toBe(3);
    expect(r.playlistTracks(db, id).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    r.reorderPlaylist(db, id, 0, 2);
    expect(r.playlistTracks(db, id).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    r.removeFromPlaylist(db, id, 'c');
    expect(r.playlistTracks(db, id).map((x) => x.id)).toEqual(['b', 'a']);
    r.addToPlaylist(db, id, [tr('d')]);
    expect(r.playlistTracks(db, id).map((x) => x.id)).toEqual(['b', 'a', 'd']);
    r.renamePlaylist(db, id, 'Road');
    expect(r.listPlaylists(db)[0]).toMatchObject({ name: 'Road', count: 3 });
    r.deletePlaylist(db, id);
    expect(r.listPlaylists(db)).toEqual([]);
  });
  it('cover uses the first 4 tracks', () => {
    const db = memoryDb();
    const id = r.createPlaylist(db, 'P');
    r.addToPlaylist(db, id, ['1', '2', '3', '4', '5'].map((x) => tr(x)));
    expect(r.listPlaylists(db)[0].art).toHaveLength(4);
  });
});

describe('history', () => {
  it('returns unique tracks, most recent first', () => {
    const db = memoryDb();
    r.addHistory(db, tr('a'), 's', 1);
    r.addHistory(db, tr('b'), 's', 2);
    r.addHistory(db, tr('a'), 's', 3);
    expect(r.recentHistory(db).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('playsSince returns every play (with repeats) at or after the cutoff, oldest first', () => {
    const db = memoryDb();
    r.addHistory(db, tr('a'), 's', 1);
    r.addHistory(db, tr('b'), 's', 5);
    r.addHistory(db, tr('a'), 's', 7);
    expect(r.playsSince(db, 5).map((x) => [x.track.id, x.playedAt])).toEqual([['b', 5], ['a', 7]]);
  });
});

describe('downloads', () => {
  it('upserts, patches and lists done tracks', () => {
    const db = memoryDb();
    r.upsertTracks(db, [tr('a')]);
    r.upsertDownload(db, { trackId: 'a', state: 'queued' });
    r.patchDownload(db, 'a', { state: 'done', path: 'p', bytes: 5 });
    expect(r.getDownload(db, 'a')).toMatchObject({ state: 'done', bytes: 5, quality: 'normal' });
    expect(r.downloadedTracks(db).map((x) => x.id)).toEqual(['a']);
    r.deleteDownload(db, 'a');
    expect(r.allDownloads(db)).toEqual([]);
  });
});

describe('MMKV migration', () => {
  const store: Record<string, unknown> = { 'library.v1': { liked: [tr('b'), tr('a')], saved: [album] }, 'history.v1': [tr('x'), tr('y')] };
  const kv = { get: <T,>(k: string) => store[k] as T | undefined, remove: (k: string) => void delete store[k] };
  it('imports once and removes the old keys', () => {
    const db = memoryDb();
    expect(migrateFromMmkv(db, kv)).toEqual({ liked: 2, saved: 1, history: 2 });
    expect(r.likedTracks(db).map((x) => x.id)).toEqual(['b', 'a']);
    expect(r.recentHistory(db).map((x) => x.id)).toEqual(['x', 'y']);
    expect(store['library.v1']).toBeUndefined();
    expect(migrateFromMmkv(db, kv)).toEqual({ liked: 0, saved: 0, history: 0 });
    expect(r.likedTracks(db)).toHaveLength(2);
  });
});
