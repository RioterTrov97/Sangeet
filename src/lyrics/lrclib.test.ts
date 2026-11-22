import { findLrclib } from './providers/lrclib';
import type { Track } from '../youtube/models';

const track = (o: Partial<Track> = {}): Track => ({ kind: 'track', id: 'x', title: 'Kesariya (Official Video) | Brahmastra', artists: [{ name: 'Arijit Singh, Pritam' }], album: { name: 'Brahmastra' } as any, artwork: [], durationSec: 269, ...o });
const rec = (duration: number, extra = {}) => ({ trackName: 't', artistName: 'a', duration, syncedLyrics: '[00:01.00]x', ...extra });

function fake(map: Record<string, any>) {
  const calls: string[] = [];
  const get = async (url: string) => {
    const u = new URL(url);
    const key = `${u.pathname.split('/').pop()}?${[...u.searchParams.keys()].join(',')}`;
    calls.push(key);
    return map[key] ?? null;
  };
  return { get, calls };
}

describe('findLrclib query fallback', () => {
  it('stops at get when it matches, with cleaned title, first artist, album and duration', async () => {
    const urls: string[] = [];
    const r = await findLrclib(track(), undefined, async (url) => (urls.push(url), rec(269)));
    expect(r?.duration).toBe(269);
    expect(urls).toHaveLength(1);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('track_name')).toBe('Kesariya');
    expect(q.get('artist_name')).toBe('Arijit Singh');
    expect(q.get('album_name')).toBe('Brahmastra');
    expect(q.get('duration')).toBe('269');
  });
  it('goes get -> search(title, artist) -> q=artist title -> q=title', async () => {
    const f = fake({});
    expect(await findLrclib(track(), undefined, f.get)).toBeUndefined();
    expect(f.calls).toEqual(['get?track_name,artist_name,album_name,duration', 'search?track_name,artist_name', 'search?q', 'search?q']);
  });
  it('takes the first search that has a strict match', async () => {
    const f = fake({ 'search?q': [rec(300), rec(270)] });
    const r = await findLrclib(track(), undefined, f.get);
    expect(r?.duration).toBe(270);
    expect(f.calls).toHaveLength(3);
  });
  it('prefers a strict match from a later query over a relaxed one from an earlier query, then relaxes to 5 s', async () => {
    const f = fake({ 'search?track_name,artist_name': [rec(273)], 'search?q': [rec(269.5)] });
    expect((await findLrclib(track(), undefined, f.get))?.duration).toBe(269.5);
    const g = fake({ 'search?track_name,artist_name': [rec(273)] });
    expect((await findLrclib(track(), undefined, g.get))?.duration).toBe(273);
    const h = fake({ 'search?track_name,artist_name': [rec(280)] });
    expect(await findLrclib(track(), undefined, h.get)).toBeUndefined();
  });
  it('a failing get does not stop the searches', async () => {
    const calls: string[] = [];
    const r = await findLrclib(track(), undefined, async (url) => {
      calls.push(url);
      if (url.includes('/get?')) throw new Error('boom');
      return [rec(269)];
    });
    expect(r?.duration).toBe(269);
    expect(calls).toHaveLength(2);
  });
});
