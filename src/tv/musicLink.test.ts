import { isMusicLink, parseMusicLink } from './musicLink';

const wrap = (url: string) => `sangeet://open?url=${encodeURIComponent(url)}`;

describe('parseMusicLink', () => {
  it('reads songs from watch links, with or without share parameters', () => {
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=AbC-123_x&feature=share')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://youtu.be/dQw4w9WgXcQ?si=x')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
  });

  it('keeps the playlist a song was opened from, but not a radio mix', () => {
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=OLAK5uy_kXyz123')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ', list: 'OLAK5uy_kXyz123' });
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
  });

  it('reads playlists, albums and artists', () => {
    expect(parseMusicLink('https://music.youtube.com/playlist?list=PLabc-DEF_123&si=q')).toEqual({ kind: 'playlist', id: 'PLabc-DEF_123' });
    expect(parseMusicLink('https://music.youtube.com/playlist?list=OLAK5uy_kXyz123')).toEqual({ kind: 'playlist', id: 'OLAK5uy_kXyz123' });
    expect(parseMusicLink('https://music.youtube.com/browse/VLPLabc123')).toEqual({ kind: 'playlist', id: 'PLabc123' });
    expect(parseMusicLink('https://music.youtube.com/browse/MPREb_AbCdEf123')).toEqual({ kind: 'album', id: 'MPREb_AbCdEf123' });
    expect(parseMusicLink('https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv')).toEqual({ kind: 'artist', id: 'UCabcdefghijklmnopqrstuv' });
    expect(parseMusicLink('https://music.youtube.com/browse/UCabcdefghijklmnopqrstuv')).toEqual({ kind: 'artist', id: 'UCabcdefghijklmnopqrstuv' });
  });

  it('keeps the start time of a song link', () => {
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=60')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ', at: 60 });
    expect(parseMusicLink('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ', at: 90 });
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx_1&t=1h2m3s')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ', list: 'PLx_1', at: 3723 });
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=0')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=abc')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
  });

  it('plays a song radio link as that song', () => {
    expect(parseMusicLink('https://music.youtube.com/playlist?list=RDAMVMdQw4w9WgXcQ')).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ' });
  });

  it('unwraps the launcher form sangeet://open?url=', () => {
    expect(parseMusicLink(wrap('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx_1'))).toEqual({ kind: 'song', videoId: 'dQw4w9WgXcQ', list: 'PLx_1' });
    expect(parseMusicLink(wrap('https://music.youtube.com/browse/MPREb_AbCdEf123'))).toEqual({ kind: 'album', id: 'MPREb_AbCdEf123' });
  });

  it('rejects what it cannot play', () => {
    for (const url of [
      'https://music.youtube.com/',
      'https://music.youtube.com/explore',
      'https://music.youtube.com/browse/FEmusic_home',
      'https://music.youtube.com/watch?v=short',
      'https://music.youtube.com/playlist?list=RDCLAK5uy_mix',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'sangeet://open',
      wrap(wrap('https://music.youtube.com/watch?v=dQw4w9WgXcQ')),
      'not a url',
      '',
    ]) {
      expect(parseMusicLink(url)).toBeNull();
    }
  });
});

describe('isMusicLink', () => {
  it('claims open links and YouTube links only, so the other sangeet:// links keep their handlers', () => {
    expect(isMusicLink(wrap('https://music.youtube.com/watch?v=dQw4w9WgXcQ'))).toBe(true);
    expect(isMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isMusicLink('sangeet://perf?on=1')).toBe(false);
    expect(isMusicLink('sangeet://dev?cmd=nav&a=home')).toBe(false);
    expect(isMusicLink('sangeet://search?q=adele')).toBe(false);
    expect(isMusicLink(null)).toBe(false);
  });
});
