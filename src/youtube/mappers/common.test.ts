import { hasLetterbox, parseViews, pickArtwork, sizedUrl, ytimgFallbacks, ytimgUrl } from './common';

const hq = 'https://i.ytimg.com/vi/abc_DEF-123/hqdefault.jpg?sqp=-oaymw&rs=AMzJL3k';
const lh3 = 'https://lh3.googleusercontent.com/xyz=w226-h226-l90-rj';

describe('artwork urls', () => {
  it('upsizes googleusercontent art', () => {
    expect(sizedUrl(lh3, 900)).toBe('https://lh3.googleusercontent.com/xyz=w900-h900-l90-rj');
    expect(sizedUrl('https://lh3.googleusercontent.com/xyz=s120', 600)).toContain('=s600');
  });
  it('upgrades ytimg frames by size', () => {
    expect(ytimgUrl(hq, 900)).toBe('https://i.ytimg.com/vi/abc_DEF-123/maxresdefault.jpg');
    expect(ytimgUrl(hq, 200)).toBe('https://i.ytimg.com/vi/abc_DEF-123/mqdefault.jpg');
    expect(sizedUrl(hq, 600)).toContain('maxresdefault');
  });
  it('leaves other urls alone', () => {
    expect(sizedUrl('https://example.com/a.jpg', 300)).toBe('https://example.com/a.jpg');
  });
  it('prefers square art over video frames', () => {
    expect(pickArtwork([{ url: lh3 }, { url: hq }], 600)).toContain('lh3.googleusercontent.com/xyz=w600-h600');
    expect(pickArtwork([{ url: hq }], 600)).toContain('maxresdefault');
    expect(pickArtwork([], 600)).toBeUndefined();
  });
  it('fallback chain only for maxres, letterbox only for 4:3 frames', () => {
    expect(ytimgFallbacks('https://i.ytimg.com/vi/a/maxresdefault.jpg')).toEqual(['https://i.ytimg.com/vi/a/sddefault.jpg', 'https://i.ytimg.com/vi/a/hqdefault.jpg']);
    expect(ytimgFallbacks(hq)).toEqual([]);
    expect(hasLetterbox('https://i.ytimg.com/vi/a/sddefault.jpg')).toBe(true);
    expect(hasLetterbox('https://i.ytimg.com/vi/a/maxresdefault.jpg')).toBe(false);
    expect(hasLetterbox('https://i.ytimg.com/vi/a/mqdefault.jpg')).toBe(false);
  });
});

describe('parseViews', () => {
  it('parses suffixed and plain counts', () => {
    expect(parseViews('1.2M views')).toBe(1_200_000);
    expect(parseViews('345K views')).toBe(345_000);
    expect(parseViews('1.2B views')).toBe(1_200_000_000);
    expect(parseViews('53M views')).toBe(53_000_000);
    expect(parseViews('1,234 views')).toBe(1234);
    expect(parseViews('1 view')).toBe(1);
  });
  it('ignores other text', () => {
    expect(parseViews('3:48')).toBeUndefined();
    expect(parseViews('Sugam Pokharel')).toBeUndefined();
    expect(parseViews(undefined)).toBeUndefined();
  });
});
