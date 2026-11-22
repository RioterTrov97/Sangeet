import { toggleSavedItem, toggleTrack } from './store';
import type { Playlist, Track } from '../youtube/models';
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));

const t = (id: string): Track => ({ kind: 'track', id, title: id, artists: [], artwork: [] });
const p: Playlist = { kind: 'playlist', id: 'p', title: 'P', artwork: [] };

describe('library store helpers', () => {
  it('likes newest first and unlikes', () => {
    const a = toggleTrack([], t('a'));
    const b = toggleTrack(a, t('b'));
    expect(b.map((x) => x.id)).toEqual(['b', 'a']);
    expect(toggleTrack(b, t('a')).map((x) => x.id)).toEqual(['b']);
  });
  it('toggles saved items by kind+id', () => {
    const s = toggleSavedItem([], p);
    expect(s).toHaveLength(1);
    expect(toggleSavedItem(s, p)).toHaveLength(0);
  });
});
