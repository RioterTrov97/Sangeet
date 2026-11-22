import * as repo from '../db/repo';
import { memoryDb } from '../db/testDb';
import { applyYtLibrary, noteLikeChange, resetTouched, type RemoteLibrary } from './ytSync';
import type { Artist, Playlist, Track } from '../youtube/models';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {}, storage: { remove: () => {} } }));
jest.mock('../util/log', () => ({ log: () => {}, logWarn: () => {} }));
jest.mock('./store', () => ({ initLibrary: () => {}, refreshLibrary: () => {} }));
jest.mock('../db/client', () => ({ getDb: () => undefined }));

const tr = (id: string): Track => ({ kind: 'track', id, title: id, artists: [], artwork: [] });
const pl = (id: string): Playlist => ({ kind: 'playlist', id, title: id, artwork: [] });
const ar = (id: string): Artist => ({ kind: 'artist', id, name: id, artwork: [] } as Artist);
const lib = (o: Partial<RemoteLibrary> = {}): RemoteLibrary => ({ liked: [], playlists: [], albums: [], artists: [], complete: { liked: true, playlists: true, albums: true, artists: true }, ...o });
const mem = () => {
  let s: any = {};
  return { read: () => s, write: (v: any) => void (s = v), get: () => s };
};
const ids = (db: any) => repo.likedTracks(db).map((x) => x.id).sort();

beforeEach(resetTouched);

describe('applyYtLibrary', () => {
  it('adds new items, removes ones that vanished remotely, keeps local rows', () => {
    const db = memoryDb();
    const store = mem();
    repo.setLiked(db, tr('mine'), true, 'local');
    applyYtLibrary(lib({ liked: [tr('a'), tr('b')], playlists: [pl('p1')] }), db, store);
    expect(ids(db)).toEqual(['a', 'b', 'mine']);
    applyYtLibrary(lib({ liked: [tr('a')], playlists: [pl('p1')] }), db, store);
    expect(ids(db)).toEqual(['a', 'mine']);
  });
  it('an empty or failed response does not delete anything', () => {
    const db = memoryDb();
    const store = mem();
    applyYtLibrary(lib({ liked: [tr('a'), tr('b')], playlists: [pl('p1')], artists: [ar('x')] }), db, store);
    const r = applyYtLibrary(lib({ complete: { liked: true, playlists: false, albums: false, artists: true } }), db, store);
    expect(ids(db)).toEqual(['a', 'b']);
    expect(repo.savedItems(db).map((x) => x.id).sort()).toEqual(['p1', 'x']);
    expect(r.removed).toBe(0);
    expect(r.skipped).toEqual(expect.arrayContaining(['liked:empty-remote', 'playlist:incomplete', 'artist:empty-remote']));
  });
  it('a truncated list adds what it has but deletes nothing', () => {
    const db = memoryDb();
    const store = mem();
    applyYtLibrary(lib({ liked: [tr('a'), tr('b'), tr('c')] }), db, store);
    applyYtLibrary(lib({ liked: [tr('a'), tr('d')], complete: { liked: false, playlists: true, albums: true, artists: true } }), db, store);
    expect(ids(db)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('only removes what the last successful sync saw: a yt row never in the snapshot stays', () => {
    const db = memoryDb();
    const store = mem();
    applyYtLibrary(lib({ liked: [tr('a')] }), db, store);
    repo.setLiked(db, tr('late'), true, 'yt'); // appeared after the snapshot
    applyYtLibrary(lib({ liked: [tr('a')] }), db, store);
    expect(ids(db)).toContain('late');
  });
  it('an item toggled while the sync ran is neither added nor removed', () => {
    const db = memoryDb();
    const store = mem();
    applyYtLibrary(lib({ liked: [tr('a'), tr('b')] }), db, store);
    noteLikeChange('b');
    noteLikeChange('c');
    applyYtLibrary(lib({ liked: [tr('a'), tr('c')] }), db, store);
    expect(ids(db)).toEqual(['a', 'b']);
  });
  it('writes the snapshot only after applying', () => {
    const db = memoryDb();
    const store = mem();
    applyYtLibrary(lib({ liked: [tr('a')], playlists: [pl('p')] }), db, store);
    expect(store.get().liked).toEqual(['a']);
    expect(store.get().saved.playlist).toEqual(['playlist-p']);
  });
});
