import { DEFAULT_LAYOUT, LAYOUTS, layoutForMode, layoutForSwitch, sideOfLayout, lyricsKind, gridColumns, parseLayout, resolveLayout, sideVideoSize } from './layout';

describe('layout parsing', () => {
  it('defaults to Video only and has the six layouts', () => {
    expect(DEFAULT_LAYOUT).toBe('video');
    expect(LAYOUTS).toEqual(['video', 'videoLyrics', 'videoLyricsOverlay', 'musicLyrics', 'music', 'lyrics']);
    expect(parseLayout('videoLyricsOverlay')).toBe('videoLyricsOverlay');
  });
  it('falls back to the default for unknown saved values', () => {
    expect(parseLayout('musicLyrics')).toBe('musicLyrics');
    expect(parseLayout('nope')).toBe('video');
    expect(parseLayout(undefined)).toBe('video');
    expect(parseLayout(3)).toBe('video');
  });
});

describe('resolveLayout fallbacks', () => {
  it('keeps the preference when everything is available or still loading', () => {
    expect(resolveLayout('video', true, 'synced')).toBe('video');
    expect(resolveLayout('video', undefined, 'loading')).toBe('video');
    expect(resolveLayout('videoLyrics', undefined, 'loading')).toBe('videoLyrics');
    expect(resolveLayout('lyrics', true, 'plain')).toBe('lyrics');
    expect(resolveLayout('musicLyrics', false, 'synced')).toBe('musicLyrics');
  });
  it('drops to the music variants when the song has no video', () => {
    expect(resolveLayout('video', null, 'synced')).toBe('music');
    expect(resolveLayout('video', false, 'loading')).toBe('music');
    expect(resolveLayout('videoLyrics', false, 'synced')).toBe('musicLyrics');
  });
  it('treats the immersive layout like the split one', () => {
    expect(resolveLayout('videoLyricsOverlay', true, 'synced')).toBe('videoLyricsOverlay');
    expect(resolveLayout('videoLyricsOverlay', undefined, 'loading')).toBe('videoLyricsOverlay');
    expect(resolveLayout('videoLyricsOverlay', false, 'synced')).toBe('musicLyrics');
    expect(resolveLayout('videoLyricsOverlay', null, 'none')).toBe('music');
    expect(resolveLayout('videoLyricsOverlay', true, 'none')).toBe('video');
    expect(resolveLayout('videoLyricsOverlay', true, 'plain')).toBe('videoLyricsOverlay');
  });
  it('drops the lyrics when there are none', () => {
    expect(resolveLayout('videoLyrics', true, 'none')).toBe('video');
    expect(resolveLayout('musicLyrics', true, 'none')).toBe('music');
    expect(resolveLayout('lyrics', true, 'none')).toBe('music');
    expect(resolveLayout('videoLyrics', false, 'none')).toBe('music');
  });
  it('never changes video-only or music-only because of lyrics', () => {
    expect(resolveLayout('video', true, 'none')).toBe('video');
    expect(resolveLayout('music', true, 'none')).toBe('music');
  });
});

describe('remote mode mapping', () => {
  it('maps the phone video/audio modes onto layouts', () => {
    expect(layoutForMode('video')).toBe('video');
    expect(layoutForMode('audio')).toBe('music');
  });
});

describe('lyricsKind', () => {
  it('classifies the lookup result', () => {
    expect(lyricsKind('loading', null)).toBe('loading');
    expect(lyricsKind('none', null)).toBe('none');
    expect(lyricsKind('ready', { synced: [{}], plain: 'x' })).toBe('synced');
    expect(lyricsKind('ready', { synced: [], plain: 'words' })).toBe('plain');
    expect(lyricsKind('ready', { plain: '  ' })).toBe('none');
  });
});

describe('gridColumns', () => {
  it('uses 2 columns, 3 only when each would be 420 px wide', () => {
    expect(gridColumns(858, 1920 / 1440)).toBe(2);
    expect(gridColumns(1100, 1920 / 1440)).toBe(3);
    expect(gridColumns(500, 2)).toBe(2);
  });
});

describe('phone Audio / Video switch', () => {
  it('maps video <-> music and keeps the lyrics panel', () => {
    expect(layoutForSwitch('music', 'video')).toBe('video');
    expect(layoutForSwitch('musicLyrics', 'video')).toBe('videoLyrics');
    expect(layoutForSwitch('lyrics', 'video')).toBe('videoLyrics');
    expect(layoutForSwitch('video', 'audio')).toBe('music');
    expect(layoutForSwitch('videoLyrics', 'audio')).toBe('musicLyrics');
    expect(layoutForSwitch('videoLyricsOverlay', 'audio')).toBe('musicLyrics');
  });
  it('goes back to the Video + Lyrics variant used last', () => {
    expect(layoutForSwitch('musicLyrics', 'video', 'videoLyricsOverlay')).toBe('videoLyricsOverlay');
    expect(layoutForSwitch('lyrics', 'video', 'videoLyricsOverlay')).toBe('videoLyricsOverlay');
    expect(layoutForSwitch('musicLyrics', 'video')).toBe('videoLyrics');
    expect(layoutForSwitch('music', 'video', 'videoLyricsOverlay')).toBe('video');
    expect(layoutForSwitch('videoLyricsOverlay', 'video')).toBe('videoLyricsOverlay');
  });
  it('leaves a layout already on that side alone', () => {
    expect(layoutForSwitch('video', 'video')).toBe('video');
    expect(layoutForSwitch('videoLyrics', 'video')).toBe('videoLyrics');
    expect(layoutForSwitch('music', 'audio')).toBe('music');
    expect(layoutForSwitch('lyrics', 'audio')).toBe('lyrics');
  });
  it('reports the side of each layout', () => {
    expect(LAYOUTS.map(sideOfLayout)).toEqual(['video', 'video', 'video', 'audio', 'audio', 'audio']);
  });
});

describe('sideVideoSize', () => {
  it('uses the full width at 16:9 when the box is tall enough', () => {
    expect(sideVideoSize(640, 800, 112)).toEqual({ width: 640, height: 360 });
  });
  it('shrinks (keeping 16:9) so the meta row fits', () => {
    const s = sideVideoSize(640, 400, 112);
    expect(s.height).toBe(288);
    expect(s.width).toBe(512);
    expect(400 - s.height).toBeGreaterThanOrEqual(112);
  });
  it('never goes negative', () => {
    expect(sideVideoSize(640, 50, 112)).toEqual({ width: 0, height: 0 });
  });
});
