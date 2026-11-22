import type { Artist, Playlist } from '../youtube/models';
import { addableYtPlaylists } from './ytPlaylists';

const pl = (id: string, author?: string): Playlist => ({ kind: 'playlist', id, title: id, author, artwork: [] });
const keys = (l: Playlist[]) => l.map((p) => `playlist-${p.id}`);
const ids = (l: Playlist[]) => l.map((p) => p.id);

describe('addableYtPlaylists', () => {
  it('drops auto playlists and rows that did not come from YouTube', () => {
    const l = [pl('PLa'), pl('LM'), pl('SE'), pl('RDCLAK1'), pl('OLAK5uy_x'), pl('PLlocal')];
    expect(ids(addableYtPlaylists(l, keys(l.slice(0, 5)), undefined))).toEqual(['PLa']);
  });
  it('prefers playlists whose author is the account', () => {
    const l = [pl('PLa', 'Asha Rai'), pl('PLb', 'Someone Else'), pl('xyz', 'Asha Rai')];
    expect(ids(addableYtPlaylists(l, keys(l), 'Asha Rai'))).toEqual(['PLa', 'xyz']);
  });
  it('falls back to PL ids when the name is unknown or nothing matches', () => {
    const l = [pl('PLa', 'X'), pl('abc', 'Y')];
    expect(ids(addableYtPlaylists(l, keys(l), undefined))).toEqual(['PLa']);
    expect(ids(addableYtPlaylists(l, keys(l), 'Nobody'))).toEqual(['PLa']);
  });
  it('ignores albums and artists', () => {
    const a: Artist = { kind: 'artist', id: 'UC1', name: 'A', artwork: [] };
    expect(addableYtPlaylists([a], ['artist-UC1'], 'A')).toEqual([]);
  });
});
