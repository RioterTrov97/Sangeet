import { parseShared, urlsIn } from './shared';

describe('shared links', () => {
  it('finds urls in a share text', () => {
    expect(urlsIn('Listen to this (https://youtu.be/dQw4w9WgXcQ?si=abc).')).toEqual(['https://youtu.be/dQw4w9WgXcQ?si=abc']);
    expect(urlsIn('no link here')).toEqual([]);
  });

  it('understands YouTube and YouTube Music links', () => {
    expect(parseShared('Never Gonna Give You Up https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x')).toEqual({ kind: 'music', link: { kind: 'song', videoId: 'dQw4w9WgXcQ' } });
    expect(parseShared('https://music.youtube.com/playlist?list=PLabcdefghij12')).toEqual({ kind: 'music', link: { kind: 'playlist', id: 'PLabcdefghij12' } });
    expect(parseShared('https://music.youtube.com/channel/UCabcdefghijklmnop')).toEqual({ kind: 'music', link: { kind: 'artist', id: 'UCabcdefghijklmnop' } });
  });

  it('understands Spotify playlists and albums', () => {
    const t = parseShared('My mix https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc');
    expect(t).toMatchObject({ kind: 'spotify', ref: { kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' } });
  });

  it('skips links it cannot open and takes the next one', () => {
    expect(parseShared('https://example.com/x https://youtu.be/dQw4w9WgXcQ')).toEqual({ kind: 'music', link: { kind: 'song', videoId: 'dQw4w9WgXcQ' } });
    expect(parseShared('https://example.com/x')).toBeUndefined();
    expect(parseShared(null)).toBeUndefined();
  });
});
