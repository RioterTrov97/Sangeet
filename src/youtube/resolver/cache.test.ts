import { StreamCache } from './cache';
import type { ResolvedStream } from './types';

const stream = (expiresAt: number): ResolvedStream => ({
  url: 'https://x/y',
  mimeType: 'audio/mp4',
  contentLength: 10,
  expiresAt,
  itag: 140,
});

describe('StreamCache', () => {
  it('returns fresh entries and drops entries within the safety margin', () => {
    let now = 1_000_000;
    const cache = new StreamCache(() => now, 60_000);
    cache.set('a', stream(now + 120_000));
    expect(cache.get('a')).toBeDefined();
    now += 61_000; // now only 59 s left, inside the margin
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('misses unknown ids and supports delete', () => {
    const cache = new StreamCache(() => 0);
    expect(cache.get('nope')).toBeUndefined();
    cache.set('a', stream(10_000_000));
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('a slow older resolve cannot overwrite a newer one (generations)', () => {
    const cache = new StreamCache(() => 0);
    const old = cache.begin('a');
    const fresh = cache.begin('a');
    expect(fresh).toBeGreaterThan(old);
    expect(cache.set('a', { ...stream(10_000_000), url: 'new' }, fresh)).toBe(true);
    expect(cache.set('a', { ...stream(10_000_000), url: 'old' }, old)).toBe(false);
    expect(cache.get('a')?.url).toBe('new');
    expect(cache.set('b', stream(10_000_000))).toBe(true); // no generation: always written
    expect(cache.set('a', { ...stream(10_000_000), url: 'later' }, cache.begin('a'))).toBe(true);
  });
});
