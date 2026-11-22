import { libraryItems, normalizeSort, playedAtMaps, sortEntries, sortSongs, type Sortable } from './items';
import type { Album, Track } from '../youtube/models';
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));

const album = (id: string, title: string): Album => ({ kind: 'album', id, title, artists: [], artwork: [] });
const track: Track = { kind: 'track', id: 't', title: 'T', artists: [{ id: 'ar', name: 'Ar' }], album: { id: 'al', name: 'Al' }, artwork: [] };

describe('libraryItems', () => {
  it('merges saved and played albums without duplicates', () => {
    const r = libraryItems('albums', [album('al', 'Al')], [track], 'recent');
    expect(r).toHaveLength(1);
  });
  it('sorts A-Z', () => {
    const r = libraryItems('albums', [album('2', 'Zed'), album('1', 'Abc')], [], 'az');
    expect(r.map((x) => x.id)).toEqual(['1', '2']);
  });
  it('downloaded is empty for now', () => expect(libraryItems('downloaded', [album('1', 'x')], [], 'recent')).toEqual([]));
});


const e = (title: string, addedAt: number, playedAt = 0, count?: number, pinned = false): Sortable => ({ title, addedAt, playedAt, count, pinned });
const names = (l: Sortable[]) => l.map((x) => x.title);

describe('sortEntries', () => {
  const list = [e('b', 20, 0, 5), e('a', 10, 300, 50), e('c', 30, 100), e('d', 5, 200, 9)];
  it('recents: last played first, never played by recently added', () => expect(names(sortEntries(list, 'recents'))).toEqual(['a', 'd', 'c', 'b']));
  it('added / oldest', () => {
    expect(names(sortEntries(list, 'added'))).toEqual(['c', 'b', 'a', 'd']);
    expect(names(sortEntries(list, 'oldest'))).toEqual(['d', 'a', 'b', 'c']);
  });
  it('alphabetical ignores case', () => expect(names(sortEntries([e('b', 0), e('A', 0), e('c', 0)], 'az'))).toEqual(['A', 'b', 'c']));
  it('track count: most first, items without a count last', () => expect(names(sortEntries(list, 'count'))).toEqual(['a', 'd', 'b', 'c']));
  it('pinned items come first, in the same order', () => expect(names(sortEntries([e('a', 1), e('z', 2, 0, 1, true), e('m', 9, 0, 1, true)], 'added'))).toEqual(['m', 'z', 'a']));
  it('is stable and does not mutate', () => {
    const l = [e('x', 1), e('x', 1)];
    const r = sortEntries(l, 'az');
    expect(r[0]).toBe(l[0]);
    expect(sortEntries(list, 'az')).not.toBe(list);
  });
});

describe('sort helpers', () => {
  it('maps the old stored value', () => {
    expect(normalizeSort('recent')).toBe('recents');
    expect(normalizeSort('az')).toBe('az');
    expect(normalizeSort('nope')).toBe('recents');
  });
  it('sorts songs', () => {
    const s = [{ title: 'b' }, { title: 'a' }, { title: 'c' }];
    expect(sortSongs(s, 'oldest').map((x) => x.title)).toEqual(['c', 'a', 'b']);
    expect(sortSongs(s, 'az').map((x) => x.title)).toEqual(['a', 'b', 'c']);
    expect(sortSongs(s, 'recents')).toBe(s);
  });
  it('finds the latest play per album and artist', () => {
    const t = (id: string, al: string, ar: string): Track => ({ kind: 'track', id, title: id, artists: [{ id: ar, name: ar }], album: { id: al, name: al }, artwork: [] });
    const m = playedAtMaps([{ track: t('1', 'A', 'X'), playedAt: 5 }, { track: t('2', 'A', 'Y'), playedAt: 9 }]);
    expect(m.albums).toEqual({ A: 9 });
    expect(m.artists).toEqual({ X: 5, Y: 9 });
  });
});
