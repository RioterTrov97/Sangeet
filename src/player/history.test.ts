import type { Track } from '../youtube/models';
import { pushHistory, recentAlbums, recentArtists } from './history';

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

