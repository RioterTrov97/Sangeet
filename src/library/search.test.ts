import type { Album, Artist, Playlist, Track } from '../youtube/models';
import { fold, matchesQuery, searchLibrary } from './search';

const track = (id: string, title: string, artist: string, album?: string): Track => ({ kind: 'track', id, title, artists: [{ name: artist }], album: album ? { id: 'a', name: album } : undefined, artwork: [] });
const album = (id: string, title: string, artist: string): Album => ({ kind: 'album', id, title, artists: [{ name: artist }], artwork: [] });
const artist = (id: string, name: string): Artist => ({ kind: 'artist', id, name, artwork: [] });
const playlist = (id: string, title: string): Playlist => ({ kind: 'playlist', id, title, artwork: [] });

describe('library search', () => {
  it('folds case and diacritics', () => {
    expect(fold('  Beyoncé ')).toBe('beyonce');
    expect(matchesQuery('BEYONCE', 'Beyoncé')).toBe(true);
    expect(matchesQuery('cafe', 'Café del Mar')).toBe(true);
  });
  it('needs every word, in any field', () => {
    expect(matchesQuery('shape ed', 'Shape of You', 'Ed Sheeran')).toBe(true);
    expect(matchesQuery('shape adele', 'Shape of You', 'Ed Sheeran')).toBe(false);
    expect(matchesQuery('', 'x')).toBe(true);
    expect(matchesQuery('xyz')).toBe(false);
  });
  it('does not match across fields', () => {
    expect(matchesQuery('youed', 'Shape of You', 'Ed Sheeran')).toBe(false);
  });
  it('searches liked, downloads, saved and local playlists without duplicates', () => {
    const r = searchLibrary('sheeran', {
      liked: [track('1', 'Shape of You', 'Ed Sheeran'), track('2', 'Hello', 'Adele')],
      downloads: [track('1', 'Shape of You', 'Ed Sheeran'), track('3', 'Perfect', 'Ed Sheeran')],
      saved: [album('a', 'Divide', 'Ed Sheeran'), artist('r', 'Ed Sheeran'), playlist('p', 'Gym'), artist('s', 'Adele')],
      playlists: [{ id: 'l', name: 'Sheeran mix' }, { id: 'm', name: 'Other' }],
    });
    expect(r.songs.map((t) => t.id)).toEqual(['1', '3']);
    expect(r.albums).toHaveLength(1);
    expect(r.artists.map((a) => a.id)).toEqual(['r']);
    expect(r.playlists).toHaveLength(0);
    expect(r.localPlaylists.map((p) => p.id)).toEqual(['l']);
  });
  it('finds songs from this iPhone, once even when liked', () => {
    const r = searchLibrary('lata', { liked: [track('local-1', 'Aaja re', 'Lata')], downloads: [], local: [track('local-1', 'Aaja re', 'Lata'), track('local-2', 'Ek pyar ka', 'Lata'), track('local-3', 'Other', 'Rafi')], saved: [], playlists: [] });
    expect(r.songs.map((t) => t.id)).toEqual(['local-1', 'local-2']);
  });
  it('matches the album name of a song', () => {
    const r = searchLibrary('divide', { liked: [track('1', 'Perfect', 'Ed Sheeran', 'Divide')], downloads: [], saved: [], playlists: [] });
    expect(r.songs).toHaveLength(1);
  });
});
