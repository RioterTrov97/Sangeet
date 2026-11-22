import { readFileSync } from 'fs';
import { join } from 'path';

import type { Track } from '../youtube/models';
import { bestMatch, matchAll, normalize, scoreMatch } from './match';
import { parseEmbedHtml, parseSpotifyLink, SpotifyError } from './spotify';

const fixture = readFileSync(join(__dirname, '__fixtures__/spotify-playlist-embed.html'), 'utf8');
const t = (id: string, title: string, artist: string, durationSec?: number): Track => ({ kind: 'track', id, title, artists: [{ name: artist }], artwork: [], durationSec });

describe('parseSpotifyLink', () => {
  it('reads playlist and album links, with query strings and locale prefixes', () => {
    expect(parseSpotifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({ kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M' });
    expect(parseSpotifyLink(' https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy ')).toEqual({ kind: 'album', id: '4aawyAB9vmqN3uQ7FjRGTy' });
    expect(parseSpotifyLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')?.kind).toBe('playlist');
  });
  it('rejects other text', () => {
    expect(parseSpotifyLink('https://open.spotify.com/track/4aawyAB9vmqN3uQ7FjRGTy')).toBeUndefined();
    expect(parseSpotifyLink('hello')).toBeUndefined();
  });
});

describe('parseEmbedHtml', () => {
  const ref = { kind: 'playlist' as const, id: '37i9dQZF1DXcBWIGoYBM5M' };
  it('reads name, cover and tracks from the recorded embed page', () => {
    const l = parseEmbedHtml(fixture, ref);
    expect(l.name).toBe('Today’s Top Hits');
    expect(l.cover).toMatch(/^https:\/\/i\.scdn\.co\//);
    expect(l.tracks).toHaveLength(5);
    expect(l.tracks[0]).toEqual({ title: 'BbY WOW', artists: ['KAROL G', 'Judeline', 'rusowsky'], durationMs: 225834 });
  });
  it('reports a private / missing list and unreadable pages', () => {
    const empty = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>';
    expect(() => parseEmbedHtml(empty, ref)).toThrow(SpotifyError);
    expect(() => parseEmbedHtml('<html></html>', ref)).toThrow(/Could not read/);
  });
});

describe('matching', () => {
  it('normalises titles', () => {
    expect(normalize('Blinding Lights (feat. X) - Remastered 2020')).toBe('blinding lights');
    expect(normalize('Beyoncé – Halo')).toBe('beyonce halo');
  });
  const src = { title: 'Blinding Lights', artists: ['The Weeknd'], durationMs: 200_000 };
  it('prefers the right song within 5 s', () => {
    const good = t('1', 'Blinding Lights', 'The Weeknd', 202);
    const cover = t('2', 'Blinding Lights', 'Some Cover Band', 201);
    const far = t('3', 'Blinding Lights (Extended)', 'The Weeknd', 400);
    expect(scoreMatch(src, good)).toBeGreaterThan(scoreMatch(src, cover));
    expect(bestMatch(src, [cover, far, good])?.id).toBe('1');
  });
  it('skips when nothing is close enough', () => {
    expect(bestMatch(src, [t('x', 'Different Song', 'The Weeknd', 200), t('y', 'Blinding Lights', 'Nobody', 300)])).toBeUndefined();
  });
  it('matches with limited concurrency and reports progress', async () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ title: `Song ${i}`, artists: ['A'], durationMs: 100_000 }));
    let running = 0;
    let peak = 0;
    const progress: number[] = [];
    const res = await matchAll(
      list,
      async (q) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        const n = /Song (\d+)/.exec(q)![1];
        return Number(n) % 2 ? [] : [t(n, `Song ${n}`, 'A', 100)];
      },
      { concurrency: 4, onProgress: (d) => progress.push(d) },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(res.filter((r) => r.match)).toHaveLength(5);
    expect(progress[progress.length - 1]).toBe(10);
  });
  it('stops when cancelled', async () => {
    const ac = new AbortController();
    const list = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, artists: [] as string[] }));
    const res = await matchAll(list, async () => (ac.abort(), []), { concurrency: 1, signal: ac.signal });
    expect(res.length).toBe(20);
  });
});
