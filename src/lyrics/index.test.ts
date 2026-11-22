import { FOUND_TTL, MISS_TTL, getLyrics, type Deps } from './index';
import { mergeSources } from './settings';
import { pickMatch } from './providers/lrclib';
import type { Track } from '../youtube/models';
import type { LyricsProvider } from './types';
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));
jest.mock('../youtube/api', () => ({ getSession: jest.fn() }));

const track = (id: string): Track => ({ kind: 'track', id, title: 't', artists: [{ name: 'a' }], artwork: [], durationSec: 200 });
const provider = (id: 'lrclib' | 'lrcred' | 'netease' | 'ytmusic', result: any, calls: string[]): LyricsProvider => ({
  id,
  label: id.toUpperCase(),
  getLyrics: async () => {
    calls.push(id);
    if (result instanceof Error) throw result;
    return result;
  },
});
function deps(providers: LyricsProvider[], sources = providers.map((p) => ({ id: p.id, enabled: true })), now = () => 1000): Deps & { store: Map<string, any> } {
  const store = new Map<string, any>();
  return { store, providers: Object.fromEntries(providers.map((p) => [p.id, p])), sources: () => sources, now, read: (k) => store.get(k), write: (k, v) => void store.set(k, v) };
}
const synced = [{ time: 1, text: 'a' }, { time: 195, text: 'b' }];

describe('provider ordering and fallback', () => {
  it('uses the first provider with a result', async () => {
    const calls: string[] = [];
    const d = deps([provider('lrclib', { synced }, calls), provider('ytmusic', { plain: 'x' }, calls)]);
    const r = await getLyrics(track('1'), d);
    expect(r?.source).toBe('LRCLIB');
    expect(calls).toEqual(['lrclib']);
  });
  it('falls through null results and errors', async () => {
    const calls: string[] = [];
    const d = deps([provider('lrclib', new Error('net'), calls), provider('ytmusic', { plain: 'x' }, calls)]);
    expect((await getLyrics(track('2'), d))?.plain).toBe('x');
    expect(calls).toEqual(['lrclib', 'ytmusic']);
  });
  it('prefers a later synced result over an earlier plain one', async () => {
    const calls: string[] = [];
    const d = deps([provider('ytmusic', { plain: 'p' }, calls), provider('lrclib', { synced }, calls)]);
    expect((await getLyrics(track('3'), d))?.providerId).toBe('lrclib');
  });
  it('respects user order and disabled toggles', async () => {
    const calls: string[] = [];
    const ps = [provider('lrclib', { synced }, calls), provider('ytmusic', { plain: 'y' }, calls)];
    const d = deps(ps, [{ id: 'ytmusic', enabled: true }, { id: 'lrclib', enabled: false }]);
    expect((await getLyrics(track('4'), d))?.source).toBe('YTMUSIC');
    expect(calls).toEqual(['ytmusic']);
  });
  it('merges saved settings with new providers', () => {
    expect(mergeSources([{ id: 'ytmusic', enabled: false }]).map((s) => s.id)).toEqual(['ytmusic', 'lrclib', 'lrcred', 'netease']);
    expect(mergeSources([{ id: 'gone' as any, enabled: true }]).map((s) => s.id)).toEqual(['lrclib', 'lrcred', 'netease', 'ytmusic']);
  });
});

describe('lyrics file next to a local song', () => {
  it('is used first for a local song, without asking any provider', async () => {
    const calls: string[] = [];
    const d = { ...deps([provider('lrclib', { synced }, calls)]), sidecar: (id: string) => (id === 'local-abc' ? '[00:01.00]hi\n[00:03.00]there' : undefined) };
    const r = await getLyrics(track('local-abc'), d);
    expect(r?.providerId).toBe('file');
    expect(calls).toEqual([]);
  });
  it('is never read for a YouTube song, and a local song without one uses the providers', async () => {
    const calls: string[] = [];
    const read = jest.fn(() => '[00:01.00]x\n[00:03.00]y');
    const d = { ...deps([provider('lrclib', { synced }, calls)]), sidecar: read };
    expect((await getLyrics(track('dQw4w9WgXcQ'), d))?.providerId).toBe('lrclib');
    expect(read).not.toHaveBeenCalled();
    const none = { ...deps([provider('lrclib', { synced }, calls)]), sidecar: () => undefined };
    expect((await getLyrics(track('local-zzz'), none))?.providerId).toBe('lrclib');
  });
});

describe('cache', () => {
  it('keeps showing expired lyrics when a fresh lookup fails (offline)', async () => {
    let now = 1000;
    let offline = false;
    const calls: string[] = [];
    const p: LyricsProvider = { id: 'lrclib', label: 'LRCLIB', getLyrics: async () => (calls.push('x'), offline ? Promise.reject(new Error('offline')) : { synced }) };
    const d = deps([p], undefined, () => now);
    expect((await getLyrics(track('old'), d))?.synced).toHaveLength(2);
    offline = true;
    now += FOUND_TTL + 1;
    expect((await getLyrics(track('old'), d))?.synced).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
  it('caches hits for 30 days and misses for a day, not network failures', async () => {
    const calls: string[] = [];
    let now = 1000;
    const d = deps([provider('lrclib', { synced }, calls)], undefined, () => now);
    await getLyrics(track('5'), d);
    now += FOUND_TTL - 1;
    await getLyrics(track('5'), d);
    expect(calls).toHaveLength(1);
    now += 2;
    await getLyrics(track('5'), d);
    expect(calls).toHaveLength(2);

    const c2: string[] = [];
    const m = deps([provider('lrclib', null, c2)], undefined, () => now);
    expect(await getLyrics(track('6'), m)).toBeNull();
    await getLyrics(track('6'), m);
    expect(c2).toHaveLength(1);
    now += MISS_TTL + 1;
    await getLyrics(track('6'), m);
    expect(c2).toHaveLength(2);

    const c3: string[] = [];
    const f = deps([provider('lrclib', new Error('x'), c3)], undefined, () => now);
    await getLyrics(track('7'), f);
    await getLyrics(track('7'), f);
    expect(c3).toHaveLength(2);
  });
});

describe('lrclib matching', () => {
  it('accepts only duration within 2 s (relaxed: 5 s) and prefers the closest', () => {
    const recs = [
      { duration: 210, syncedLyrics: 'x' },
      { duration: 201, plainLyrics: 'p' },
      { duration: 199.5, syncedLyrics: 's' },
    ];
    expect(pickMatch(recs, 200)?.duration).toBe(199.5);
    expect(pickMatch([{ duration: 203, syncedLyrics: 'x' }], 200)).toBeUndefined();
    expect(pickMatch([{ duration: 203, syncedLyrics: 'x' }], 200, 5)?.duration).toBe(203);
    expect(pickMatch([{ duration: 230, syncedLyrics: 'x' }], 200, 5)).toBeUndefined();
    expect(pickMatch([{ duration: 200, instrumental: true, plainLyrics: 'x' }], 200)).toBeUndefined();
  });
});

describe('different version of the song', () => {
  it('skips synced lyrics timed for another length and tries the next source', async () => {
    const calls: string[] = [];
    const d = deps([provider('lrclib', { synced, durationSec: 280 }, calls), provider('ytmusic', { synced, durationSec: 201 }, calls)]);
    const r = await getLyrics(track('v1'), d);
    expect(r?.providerId).toBe('ytmusic');
    expect(r?.synced).toBeTruthy();
  });
  it('falls back to unsynced text when no source matches the length', async () => {
    const d = deps([provider('lrclib', { synced, durationSec: 280 }, [])]);
    const r = await getLyrics(track('v2'), d);
    expect(r?.synced).toBeUndefined();
    expect(r?.plain).toBe('a\nb');
  });
});

describe('timeouts', () => {
  it('a provider that hangs is abandoned after its limit and the next provider answers', async () => {
    const hang: LyricsProvider = { id: 'lrclib', label: 'LRCLIB', getLyrics: () => new Promise(() => {}) };
    const calls: string[] = [];
    const d = { ...deps([hang, provider('ytmusic', { plain: 'y' }, calls)]), providerTimeoutMs: 20, overallTimeoutMs: 1000 };
    const r = await getLyrics(track('t1'), d);
    expect(r?.plain).toBe('y');
    expect(calls).toEqual(['ytmusic']);
  });
  it('passes an abort signal that fires on timeout', async () => {
    let aborted = false;
    const p: LyricsProvider = { id: 'lrclib', label: 'LRCLIB', getLyrics: (_t, signal) => new Promise((_r, rej) => signal?.addEventListener('abort', () => ((aborted = true), rej(new Error('aborted'))))) };
    const d = { ...deps([p]), providerTimeoutMs: 20 };
    expect(await getLyrics(track('t2'), d)).toBeNull();
    expect(aborted).toBe(true);
    expect(d.store.size).toBe(0); // a timeout is not cached as "not found"
  });
  it('the overall limit stops later providers', async () => {
    const calls: string[] = [];
    const hang = (id: 'lrclib' | 'lrcred' | 'netease' | 'ytmusic'): LyricsProvider => ({ id, label: id, getLyrics: () => new Promise(() => {}) });
    const d = { ...deps([hang('lrclib'), provider('ytmusic', { plain: 'y' }, calls)]), providerTimeoutMs: 1000, overallTimeoutMs: 20 };
    expect(await getLyrics(track('t3'), d)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('credit lines', () => {
  it('are stripped from provider results', async () => {
    const d = deps([provider('lrclib', { plain: 'Lyrics by X\nMusic: Y\nhello\nworld' }, [])]);
    expect((await getLyrics(track('c1'), d))?.plain).toBe('hello\nworld');
  });
});

describe('lrclib + lrcred in parallel, script preference', () => {
  const slow = (id: 'lrclib' | 'lrcred' | 'netease' | 'ytmusic', ms: number, result: any, calls: string[]): LyricsProvider => ({
    id,
    label: id,
    getLyrics: async () => {
      calls.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, ms));
      return result;
    },
  });
  const dev = [{ time: 1, text: 'मुझको इतना बताए कोई' }, { time: 195, text: 'कैसे तुझसे दिल' }];
  const hasDev = (t: Track): Track => ({ ...t, title: 'केसरिया' });

  it('starts both at once and prefers lrclib when both match', async () => {
    const calls: string[] = [];
    const d = deps([slow('lrclib', 30, { synced }, calls), slow('lrcred', 5, { synced }, calls)]);
    const r = await getLyrics(track('p1'), d);
    expect(calls.slice(0, 2).sort()).toEqual(['start:lrclib', 'start:lrcred']);
    expect(r?.providerId).toBe('lrclib');
  });
  it('takes lrcred when lrclib misses, without waiting for the rest', async () => {
    const calls: string[] = [];
    const d = deps([slow('lrclib', 5, null, calls), slow('lrcred', 10, { synced }, calls), slow('ytmusic', 5, { plain: 'x' }, calls)]);
    expect((await getLyrics(track('p2'), d))?.providerId).toBe('lrcred');
    expect(calls).not.toContain('start:ytmusic');
  });
  it('a failing member does not break the other', async () => {
    const d = deps([provider('lrclib', new Error('down'), []), slow('lrcred', 5, { synced }, [])]);
    expect((await getLyrics(track('p3'), d))?.providerId).toBe('lrcred');
  });
  it('groups the pair at the earlier position', async () => {
    const calls: string[] = [];
    const d = deps([provider('netease', { synced }, calls), provider('lrclib', null, calls), provider('lrcred', null, calls)]);
    await getLyrics(track('p4'), d);
    expect(calls[0]).toBe('netease');
  });
  it('Devanagari lrcred beats Latin lrclib of the same sync level', async () => {
    const d = { ...deps([slow('lrclib', 5, { synced }, []), slow('lrcred', 20, { synced: dev }, [])]), parallelGraceMs: 200 };
    const r = await getLyrics(track('p5'), d);
    expect(r?.providerId).toBe('lrcred');
  });
  it('Latin NetEase does not win over a Devanagari result for a Devanagari track', async () => {
    const calls: string[] = [];
    const d = deps([provider('lrclib', null, calls), provider('lrcred', { synced }, calls), provider('netease', { synced }, calls), provider('ytmusic', { synced: dev }, calls)]);
    const r = await getLyrics(hasDev(track('p6')), d);
    expect(r?.providerId).toBe('ytmusic');
  });
  it('keeps the Latin synced result when no Devanagari one exists', async () => {
    const d = deps([provider('lrclib', { synced }, []), provider('netease', null, []), provider('ytmusic', { plain: 'p' }, [])]);
    const r = await getLyrics(hasDev(track('p7')), d);
    expect(r?.providerId).toBe('lrclib');
    expect(r?.synced).toBeTruthy();
  });
  it('does not keep looking for Devanagari on a Latin-titled track', async () => {
    const calls: string[] = [];
    const d = deps([provider('lrclib', { synced }, calls), provider('netease', { synced: dev }, calls)]);
    await getLyrics(track('p8'), d);
    expect(calls).toEqual(['lrclib']);
  });
});
