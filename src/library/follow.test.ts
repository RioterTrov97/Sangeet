import { setDb } from '../db/client';
import { memoryDb } from '../db/testDb';
import * as repo from '../db/repo';
import type { Artist } from '../youtube/models';
import { followedArtists, isFollowing, refreshLibrary, setFollowSync, toggleFollow } from './store';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {}, storage: { remove: () => {} } }));

const artist = (id: string): Artist => ({ kind: 'artist', id, name: id, artwork: [], channelId: `UC_${id}` });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('follow artists', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    setDb(memoryDb());
    refreshLibrary();
  });
  afterEach(() => setFollowSync(undefined));

  it('repo: followed artists newest first, only artists', () => {
    const db = memoryDb();
    repo.setSaved(db, artist('a'), true, 'local', 1);
    repo.setSaved(db, artist('b'), true, 'yt', 2);
    repo.setSaved(db, { kind: 'playlist', id: 'p', title: 'P', artwork: [] }, true);
    expect(repo.followedArtists(db).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('toggles follow locally and persists it', () => {
    expect(toggleFollow(artist('a'))).toBe(true);
    expect(isFollowing('a')).toBe(true);
    expect(followedArtists().map((a) => a.id)).toEqual(['a']);
    expect(toggleFollow(artist('a'))).toBe(false);
    expect(isFollowing('a')).toBe(false);
  });

  it('mirrors to YouTube when a sync is registered', async () => {
    const sync = jest.fn().mockResolvedValue(undefined);
    setFollowSync(sync);
    toggleFollow(artist('a'));
    await flush();
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), true);
    expect(isFollowing('a')).toBe(true);
  });

  it('rolls back the optimistic follow when the YouTube call fails', async () => {
    setFollowSync(jest.fn().mockRejectedValue(new Error('status code 500')));
    toggleFollow(artist('a'));
    expect(isFollowing('a')).toBe(true); // optimistic
    await flush();
    expect(isFollowing('a')).toBe(false);
  });

  it('rolls back an unfollow too', async () => {
    toggleFollow(artist('a'));
    setFollowSync(jest.fn().mockRejectedValue(new Error('boom')));
    toggleFollow(artist('a'));
    expect(isFollowing('a')).toBe(false);
    await flush();
    expect(isFollowing('a')).toBe(true);
  });
});
