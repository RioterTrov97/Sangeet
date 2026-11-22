import type { Album, Artist, Track } from '../youtube/models';
import { affinityArtistIds, artistCards, boostLiked, freshOnly, isPersonalised, latestReleases, mergeArtists, MIN_PLAYS, newFromFollowed, pickSeeds, topArtists, type Play } from './personalize';

const NOW = 100 * 86_400_000;
const D = 86_400_000;
const tr = (id: string, artist: string): Track => ({ kind: 'track', id, title: `T ${id}`, artists: [{ id: `UC${artist}`, name: artist }], artwork: [] });
const play = (t: Track, daysAgo: number): Play => ({ track: t, playedAt: NOW - daysAgo * D });
const a1 = tr('a1', 'A'), a2 = tr('a2', 'A'), b1 = tr('b1', 'B'), c1 = tr('c1', 'C');

describe('personalisation', () => {
  it('threshold', () => {
    expect(isPersonalised([play(a1, 1), play(a1, 2), play(a1, 3), play(a1, 4)])).toBe(false);
    expect(isPersonalised(Array.from({ length: MIN_PLAYS }, () => play(a1, 1)))).toBe(true);
  });
  const plays = [play(a1, 1), play(a1, 2), play(a2, 3), play(b1, 1), play(b1, 2), play(c1, 0), play(c1, 40), play(c1, 41), play(c1, 42)];
  it('ranks artists by 30-day plays, ignoring older plays', () => {
    const top = topArtists(plays, NOW);
    expect(top.map((t) => [t.name, t.count])).toEqual([['A', 3], ['B', 2], ['C', 1]]);
    expect(top[0].topTrack.id).toBe('a1');
  });
  it('breaks ties by recency and respects limit', () => {
    const top = topArtists([play(b1, 2), play(c1, 1)], NOW, 1);
    expect(top).toHaveLength(1);
    expect(top[0].name).toBe('C');
  });
  it('ignores tracks without an artist id', () => {
    expect(topArtists([{ track: { ...a1, artists: [{ name: 'x' }] }, playedAt: NOW }], NOW)).toEqual([]);
  });
  it('seeds: most played, one per artist', () => {
    expect(pickSeeds(plays, NOW, 2).map((t) => t.id)).toEqual(['a1', 'b1']);
  });
  it('boosts liked artists lightly (cap, stable)', () => {
    const alb = (id: string, artist: string): Album => ({ kind: 'album', id, title: id, artists: [{ id: `UC${artist}`, name: artist }], artwork: [] });
    const items = [alb('1', 'X'), alb('2', 'Y'), alb('3', 'B'), alb('4', 'A'), alb('5', 'Z')];
    const liked = affinityArtistIds([b1], [{ id: 'UCA', name: 'A', count: 1, lastPlayedAt: 0, topTrack: a1 }]);
    expect(boostLiked(items, liked).map((i) => i.id)).toEqual(['3', '4', '1', '2', '5']);
    expect(boostLiked(items, liked, 1).map((i) => i.id)).toEqual(['3', '1', '2', '4', '5']);
    expect(boostLiked(items, new Set())).toBe(items);
  });
  it('artist cards and freshOnly', () => {
    expect(artistCards(topArtists(plays, NOW, 1))[0]).toMatchObject({ kind: 'artist', id: 'UCA', name: 'A' });
    expect(freshOnly([a1, a2, b1, c1], 'a1', [b1]).map((t) => t.id)).toEqual(['a2', 'c1']);
  });
});

describe('followed artists', () => {
  const fa = (id: string, name = id): Artist => ({ kind: 'artist', id, name, artwork: [] });
  const al = (id: string, year?: string): Album => ({ kind: 'album', id, title: id, artists: [], artwork: [], year });
  const top = [{ id: 'UCA', name: 'A', count: 2, lastPlayedAt: 0, topTrack: a1 }];

  it('affinity includes followed artists', () => {
    expect([...affinityArtistIds([], [], [fa('UCF')])]).toEqual(['UCF']);
    expect(affinityArtistIds([], top, [fa('UCF')]).has('UCA')).toBe(true);
  });
  it('followed artists boost their releases to the front', () => {
    const items = [al('1'), { ...al('2'), artists: [{ id: 'UCF', name: 'F' }] }, al('3')];
    expect(boostLiked(items, affinityArtistIds([], [], [fa('UCF')])).map((i) => i.id)).toEqual(['2', '1', '3']);
  });
  it('mergeArtists: followed first, deduped against top artists', () => {
    expect(mergeArtists([fa('UCA', 'A'), fa('UCF')], top).map((a) => a.id)).toEqual(['UCA', 'UCF']);
    expect(mergeArtists([], top).map((a) => a.id)).toEqual(['UCA']);
  });
  it('latestReleases: newest year first, capped', () => {
    expect(latestReleases({ albums: [al('old', '2019'), al('mid', '2023')], singles: [al('new', '2026')] }, 2).map((a) => a.id)).toEqual(['new', 'mid']);
    expect(latestReleases({ albums: [al('x'), al('y')], singles: [] }, 1).map((a) => a.id)).toEqual(['x']);
  });
  it('newFromFollowed: recent only, newest first, deduped, capped', () => {
    const out = newFromFollowed([[al('a1', '2026'), al('a2', '2020')], [al('b1', '2026'), al('a1', '2026')], []], 2025, 5);
    expect(out.map((a) => a.id)).toEqual(['a1', 'b1']);
    expect(newFromFollowed([[al('z', '2026'), al('y', '2026'), al('x', '2026')]], 2025, 2)).toHaveLength(2);
    expect(newFromFollowed([[al('old', '2010')]], 2025)).toEqual([]);
  });
});
