import type { Album, Shelf, Track } from '../youtube/models';
import { dedupeInto, filterFeed, homeOrder, itemKey, mergeReleases, mixQuickPicks, uniqueItems, ytQuickPicks } from './layout';

const art = [{ url: 'u', width: 1, height: 1 }];
const tr = (id: string, withArt = true): Track => ({ kind: 'track', id, title: id, artists: [{ id: 'UC', name: 'A' }], artwork: withArt ? art : [] });
const al = (id: string, year?: string): Album => ({ kind: 'album', id, title: id, artists: [], artwork: art, year });
const ids = (l: { id: string }[]) => l.map((x) => x.id);
const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => tr(`${p}${i}`));

describe('quick picks', () => {
  it('finds the YT shelf', () => {
    expect(ytQuickPicks([{ title: 'Mix', items: [tr('x')] }, { title: 'Quick picks', items: [tr('q')] }])).toHaveLength(1);
    expect(ytQuickPicks(undefined)).toEqual([]);
  });
  it('default: YT items, falling back to trending, skipping artless, max 8', () => {
    const base = { personalised: false, recent: [], top: [], followed: [] };
    expect(ids(mixQuickPicks({ ...base, yt: [...many('q', 12), tr('noart', false)], trending: [] }))).toEqual(many('q', 8).map((t) => t.id));
    expect(ids(mixQuickPicks({ ...base, yt: [], trending: many('t', 3) }))).toEqual(['t0', 't1', 't2']);
  });
  it('personalised: interleaves recent/top/followed/yt and dedupes', () => {
    const out = mixQuickPicks({ yt: [tr('y0'), tr('r0')], trending: [], personalised: true, recent: [tr('r0'), tr('r1')], top: [tr('r0'), tr('t0')], followed: [tr('f0')] });
    expect(ids(out)).toEqual(['r0', 'f0', 'y0', 'r1', 't0']);
    expect(new Set(ids(out)).size).toBe(out.length);
  });
  it('avoids top-song ids when enough remain, else tops up with them', () => {
    const yt = many('q', 10);
    const avoid = new Set([itemKey(yt[0]), itemKey(yt[1])]);
    expect(ids(mixQuickPicks({ yt, trending: [], personalised: false, recent: [], top: [], followed: [], avoid }))[0]).toBe('q2');
    expect(ids(mixQuickPicks({ yt: many('q', 7), trending: [], personalised: false, recent: [], top: [], followed: [], avoid }))).toHaveLength(7);
  });
});

describe('merge & dedupe', () => {
  it('merges releases newest first, mixing kinds, capped', () => {
    const out = mergeReleases([al('a1', '2023'), al('a2', '2025')], [al('s1', '2025'), al('s2', '2024')], 3);
    expect(ids(out)).toEqual(['s1', 'a2', 's2']);
    expect(ids(mergeReleases([al('a', '2024')], [al('a', '2024')]))).toEqual(['a']);
  });
  it('uniqueItems keeps first', () => expect(ids(uniqueItems([tr('a'), tr('a'), tr('b')]))).toEqual(['a', 'b']));
  it('dedupeInto drops seen items and claims the rest', () => {
    const seen = new Set([itemKey(tr('a'))]);
    expect(ids(dedupeInto(many('x', 5).concat(tr('a')), seen))).toEqual(['x0', 'x1', 'x2', 'x3', 'x4']);
    expect(seen.has(itemKey(tr('x0')))).toBe(true);
  });
  it('dedupeInto keeps the original when too little would remain', () => {
    const seen = new Set([itemKey(tr('a')), itemKey(tr('b'))]);
    expect(ids(dedupeInto([tr('a'), tr('b'), tr('c'), tr('d')], seen, { min: 3 }))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('dedupeInto caps', () => expect(dedupeInto(many('x', 20), new Set(), { max: 10 })).toHaveLength(10));
});

describe('feed filtering', () => {
  it('drops duplicate/own/empty shelves and repeated items', () => {
    const feed: Shelf[] = [
      { title: 'Quick picks', items: many('q', 5) },
      { title: 'Trending songs', items: many('t', 5) },
      { title: 'Empty', items: [] },
      { title: 'Mixed for you', items: many('m', 5) },
      { title: 'Mixed for you', items: many('n', 5) },
      { title: 'Chill', items: [...many('m', 2), ...many('c', 4)] },
    ];
    const seen = new Set([itemKey(tr('m0')), itemKey(tr('m1'))]);
    const out = filterFeed(feed, seen);
    expect(out.map((s) => s.title)).toEqual(['Mixed for you', 'Chill']);
    expect(ids(out[1].items)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });
});

describe('order', () => {
  it('default and personalised', () => {
    expect(homeOrder(false, false).slice(0, 3)).toEqual(['quick', 'topSongs', 'newReleases']);
    expect(homeOrder(true, true).slice(0, 8)).toEqual(['quick', 'recent', 'because', 'topSongs', 'followedNew', 'artists', 'mixes', 'newReleases']);
    expect(homeOrder(true, false)).not.toContain('followedNew');
  });
});
