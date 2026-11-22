import type { Track } from '../youtube/models';
import { mergeHistory, pushHistory, recentAlbums, recentArtists } from './history';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));

const t = (id: string, album?: string, artist?: string): Track => ({
  kind: 'track', id, title: id, artwork: [],
  artists: artist ? [{ id: artist, name: artist }] : [],
  album: album ? { id: album, name: album } : undefined,
});

describe('history', () => {
  it('puts the newest first and moves repeats to the front', () => {
    const h = pushHistory(pushHistory(pushHistory([], t('a')), t('b')), t('a'));
    expect(h.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('caps the list', () => {
    let h: Track[] = [];
    for (let i = 0; i < 60; i++) h = pushHistory(h, t(`t${i}`));
    expect(h).toHaveLength(50);
    expect(h[0].id).toBe('t59');
  });
  it('derives distinct albums and artists in play order', () => {
    const h = [t('1', 'A1', 'X'), t('2', 'A1', 'Y'), t('3', 'A2', 'X'), t('4')];
    expect(recentAlbums(h).map((a) => a.id)).toEqual(['A1', 'A2']);
    expect(recentArtists(h).map((a) => a.id)).toEqual(['X', 'Y']);
  });
});


describe('mergeHistory', () => {
  const ids = (l: Track[]) => l.map((x) => x.id);
  it('puts the 5 newest local plays first, then interleaves remote first', () => {
    const local = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].map((i) => t(i));
    const remote = ['r1', 'r2', 'l2', 'r3'].map((i) => t(i));
    expect(ids(mergeHistory(local, remote))).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'r1', 'l6', 'r2', 'l7', 'r3']);
  });
  it('caps and keeps local-only ids', () => {
    const remote = Array.from({ length: 80 }, (_, i) => t(`r${i}`));
    const out = mergeHistory([t('local:abc')], remote, 10);
    expect(out).toHaveLength(10);
    expect(out[0].id).toBe('local:abc');
  });
  it('works with an empty side', () => {
    expect(ids(mergeHistory([], [t('a'), t('b')]))).toEqual(['a', 'b']);
    expect(ids(mergeHistory([t('a')], []))).toEqual(['a']);
  });
});
