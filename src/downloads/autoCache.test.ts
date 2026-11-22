import { evictionOrder, isAvailableOffline, planAutoTrim, type CacheEntry } from './autoCache';

jest.mock('../../modules/stream-proxy', () => ({ __esModule: true, default: {} }));
jest.mock('../db/client', () => ({ getDb: () => ({}) }));
jest.mock('../db/repo', () => ({ playStats: () => new Map() }));
jest.mock('../library/store', () => ({ useLibraryStore: { getState: () => ({ liked: [] }) } }));
jest.mock('./manager', () => ({ isDownloaded: () => false }));
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));


const e = (id: string, o: Partial<CacheEntry> = {}): CacheEntry => ({ id, bytes: 100, playCount: 1, liked: false, lastPlayed: 0, ...o });

describe('evictionOrder', () => {
  it('evicts one-off unliked songs first (oldest first), then the least played, liked songs last', () => {
    const order = evictionOrder([
      e('likedOne', { liked: true, playCount: 1, lastPlayed: 1 }),
      e('often', { playCount: 9, lastPlayed: 50 }),
      e('twice', { playCount: 2, lastPlayed: 40 }),
      e('oneOffNew', { playCount: 1, lastPlayed: 90 }),
      e('oneOffOld', { playCount: 1, lastPlayed: 10 }),
      e('never', { playCount: 0, lastPlayed: 5 }),
      e('likedMany', { liked: true, playCount: 20, lastPlayed: 99 }),
    ]);
    expect(order).toEqual(['never', 'oneOffOld', 'oneOffNew', 'twice', 'often', 'likedOne', 'likedMany']);
  });
  it('breaks ties among repeat songs by age', () => {
    expect(evictionOrder([e('b', { playCount: 3, lastPlayed: 20 }), e('a', { playCount: 3, lastPlayed: 10 })])).toEqual(['a', 'b']);
  });
});

describe('planAutoTrim', () => {
  const list = [e('x', { lastPlayed: 1 }), e('y', { lastPlayed: 2 }), e('z', { playCount: 5, lastPlayed: 3 })];
  it('deletes nothing when under the limit', () => expect(planAutoTrim(list, 300)).toEqual([]));
  it('deletes just enough, in eviction order', () => expect(planAutoTrim(list, 250)).toEqual(['x']));
  it('skips protected songs', () => expect(planAutoTrim(list, 150, new Set(['x']))).toEqual(['y', 'z']));
  it('limit 0 (off) clears everything not protected', () => expect(planAutoTrim(list, 0, new Set(['z']))).toEqual(['x', 'y']));
});

describe('isAvailableOffline', () => {
  it('counts a song from this iPhone as available, and an unknown YouTube id as not', () => {
    expect(isAvailableOffline('local-0123456789abcdef')).toBe(true);
    expect(isAvailableOffline('dQw4w9WgXcQ')).toBe(false);
  });
});
