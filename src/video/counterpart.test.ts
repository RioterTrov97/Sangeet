/* eslint-disable import/first */
jest.mock('../util/storage', () => {
  const m = new Map<string, string>();
  return {
    __mem: m,
    getJson: (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : undefined),
    setJson: (k: string, v: unknown) => void m.set(k, JSON.stringify(v)),
    storage: { remove: (k: string) => void m.delete(k), getString: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v) },
  };
});
jest.mock('../util/log', () => ({ log: () => {}, logWarn: () => {} }));
jest.mock('./offsets', () => ({ noteVideoDuration: jest.fn() }));
jest.mock('../youtube/api', () => ({
  getVideoCounterpart: jest.fn(),
  getVideoMeta: jest.fn(),
  hasAuthCookieSet: jest.fn(() => false),
  searchWebVideos: jest.fn(),
  searchYtmVideos: jest.fn(),
}));

import * as api from '../youtube/api';
import type { Track } from '../youtube/models';
import { _reloadForTests, canChooseVideo, chooseVideo, getVideoCandidates, knownVideoId, loadEntries, markVideoUnplayable, MAX_VERIFY, MISS_TTL_MS, PARTIAL_RETRY_MS, recheckVideo, resolveVideoId, runChain, useCounterparts, type ChainDeps } from './counterpart';
import { MATCHER_VERSION, type VideoCandidate } from './match';
import { allowLyric, setAllowLyric } from './settings';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockMem: Map<string, string> = require('../util/storage').__mem;

const song: Track = { kind: 'track', id: 'song1', title: 'Blue Moon', artists: [{ name: 'Nova' }], durationSec: 200, artwork: [] };
const ytmTrack = (id: string, title: string, artist = 'Nova', views = 5_000_000, dur = 205): Track => ({ kind: 'track', id, title, artists: [{ name: artist }], durationSec: dur, artwork: [], videoType: 'official', views, isVideo: true });
const MV = ytmTrack('mvOfficial', 'Nova - Blue Moon (Official Video)');
const webCand = (id: string, title: string, channel: string, views = 5_000_000, dur = 205, verified = true): VideoCandidate => ({ id, title, channel: { name: channel, verified }, durationSec: dur, views, source: 'web' });
const LYRIC = webCand('lyr1', 'Blue Moon (Lyric Video)', 'Nova', 400_000, 201);

type Spy = ChainDeps & { calls: string[] };
function deps(p: Partial<ChainDeps> = {}): Spy {
  const calls: string[] = [];
  const d: ChainDeps = {
    signedIn: () => false,
    counterpart: async (id) => (calls.push(`next:${id}`), null),
    ytmVideos: async (q) => (calls.push(`ytm:${q}`), []),
    webVideos: async (q) => (calls.push(`web:${q}`), []),
    meta: async (id) => (calls.push(`meta:${id}`), { videoType: 'ugc', artists: [{ name: 'Nova' }] }),
    ...p,
  };
  return Object.assign(d, { calls });
}

beforeEach(() => {
  mockMem.clear();
  _reloadForTests();
  setAllowLyric(true);
  jest.clearAllMocks();
  (api.hasAuthCookieSet as jest.Mock).mockReturnValue(false);
});

describe('songs from this iPhone', () => {
  it('have no video and never run the chain', async () => {
    const local: Track = { ...song, id: 'local-0123456789abcdef' };
    expect(await resolveVideoId(local)).toBeNull();
    expect(knownVideoId(local)).toBeNull();
    expect(canChooseVideo(local)).toBe(false);
    expect(api.getVideoCounterpart).not.toHaveBeenCalled();
    expect(api.searchYtmVideos).not.toHaveBeenCalled();
  });
});

describe('chain order', () => {
  it('stops at the first tier A (YTM search): no web requests', async () => {
    const d = deps({ ytmVideos: async (q) => (d.calls.push(`ytm:${q}`), [MV]) });
    const r = await runChain(song, { lyric: true }, d);
    expect(r.best?.id).toBe('mvOfficial');
    expect(r.best?.tier).toBe('A');
    expect(d.calls).toEqual(['ytm:Blue Moon Nova']);
    expect(r.requests).toBe(1);
  });

  it('goes ytm -> web -> web "official video" while there is no tier A, then verifies a web-only pick', async () => {
    const d = deps({ webVideos: async (q) => (d.calls.push(`web:${q}`), q.endsWith('official video') ? [webCand('webMv', 'Nova - Blue Moon (Official Music Video)', 'Nova')] : []) });
    const r = await runChain(song, { lyric: true }, d);
    expect(d.calls.slice(0, 3)).toEqual(['ytm:Blue Moon Nova', 'web:Blue Moon Nova', 'web:Blue Moon Nova official video']);
    expect(r.best?.id).toBe('webMv');
    expect(d.calls.filter((c) => c.startsWith('meta')).length).toBeLessThanOrEqual(MAX_VERIFY);
  });

  it('asks /next first only when signed in, and takes its answer without searching', async () => {
    const d = deps({ signedIn: () => true, counterpart: async () => 'nextVid' });
    const r = await runChain(song, { lyric: true }, d);
    expect(r.direct).toBe('nextVid');
    expect(d.calls).toEqual([]);
    const anon = deps();
    await runChain(song, { lyric: true }, anon);
    expect(anon.calls.some((c) => c.startsWith('next:'))).toBe(false);
  });

  it('verify is capped at 2 /next calls per song, across all layers', async () => {
    const many = ['a', 'b', 'c', 'd'].map((x, i) => webCand(`w${x}`, 'Blue Moon (Official Video)', 'Nova', 9_000_000 - i * 1000));
    const d = deps({ webVideos: async () => many, meta: async (id) => (d.calls.push(`meta:${id}`), { videoType: 'song', artists: [{ name: 'Nova' }] }) });
    await runChain(song, { lyric: true }, d);
    expect(d.calls.filter((c) => c.startsWith('meta')).length).toBe(MAX_VERIFY);
  });

  it('a tier B pick needs the lyric setting and never replaces a tier A', async () => {
    const withLyric = await runChain(song, { lyric: true }, deps({ webVideos: async () => [LYRIC] }));
    expect(withLyric.best?.tier).toBe('B');
    const without = await runChain(song, { lyric: false }, deps({ webVideos: async () => [LYRIC] }));
    expect(without.best).toBeUndefined();
    const both = await runChain(song, { lyric: true }, deps({ ytmVideos: async () => [MV], webVideos: async () => [LYRIC] }));
    expect(both.best?.id).toBe('mvOfficial');
  });
});

describe('partial failures', () => {
  it('a throwing layer marks the result partial; the next layers still run', async () => {
    const d = deps({ ytmVideos: async () => Promise.reject(new Error('429')), webVideos: async () => [webCand('webMv', 'Nova - Blue Moon (Official Video)', 'Nova')] });
    const r = await runChain(song, { lyric: true }, d);
    expect(r.partial).toBe(true);
    expect(r.best?.id).toBe('webMv');
  });

  it('a partial miss is not persisted and is retried after 10 minutes; a clean miss is cached', async () => {
    (api.searchYtmVideos as jest.Mock).mockRejectedValue(new Error('offline'));
    (api.searchWebVideos as jest.Mock).mockResolvedValue([]);
    expect(await resolveVideoId(song)).toBeNull();
    expect(JSON.parse(mockMem.get('video.counterparts.v4') ?? '{}')['song1']).toBeUndefined();
    const calls = (api.searchYtmVideos as jest.Mock).mock.calls.length;
    expect(await resolveVideoId(song)).toBeNull();
    expect((api.searchYtmVideos as jest.Mock).mock.calls.length).toBe(calls); // within 10 min: not asked again
    jest.useFakeTimers().setSystemTime(Date.now() + PARTIAL_RETRY_MS + 1000);
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([MV]);
    expect(await resolveVideoId(song)).toBe('mvOfficial');
    jest.useRealTimers();
  });

  it('a clean miss persists and expires after the TTL', async () => {
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([]);
    (api.searchWebVideos as jest.Mock).mockResolvedValue([]);
    expect(await resolveVideoId(song)).toBeNull();
    const saved = JSON.parse(mockMem.get('video.counterparts.v4')!);
    expect(saved.song1).toMatchObject({ id: null, v: MATCHER_VERSION });
    const now = saved.song1.at;
    expect(loadEntries(saved, now + MISS_TTL_MS - 1000).song1).toBeDefined();
    expect(loadEntries(saved, now + MISS_TTL_MS + 1000).song1).toBeUndefined();
  });
});

describe('persistence and migration', () => {
  it('a hit persists with tier, score and the top candidates, and survives a reload', async () => {
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([MV]);
    expect(await resolveVideoId(song)).toBe('mvOfficial');
    const saved = JSON.parse(mockMem.get('video.counterparts.v4')!);
    expect(saved.song1).toMatchObject({ id: 'mvOfficial', tier: 'A', v: MATCHER_VERSION });
    expect(saved.song1.cands[0].id).toBe('mvOfficial');
    _reloadForTests();
    (api.searchYtmVideos as jest.Mock).mockClear();
    expect(await resolveVideoId(song)).toBe('mvOfficial');
    expect(api.searchYtmVideos).not.toHaveBeenCalled();
    expect(useCounterparts.getState().map.song1).toBe('mvOfficial');
  });

  it('drops old-version entries below tier A or without an id on load, keeps tier A hits', () => {
    const e = loadEntries({ a: { id: 'x', tier: 'A', at: 1, v: 3 }, b: { id: 'y', tier: 'B', at: 1, v: 3 }, c: { id: null, at: Date.now(), v: 3 }, d: { id: 'z', tier: 'B', at: 1, v: MATCHER_VERSION } });
    expect(Object.keys(e).sort()).toEqual(['a', 'd']);
  });

  it('migrates v3 hits once as tier A and deletes the v3 key', () => {
    mockMem.set('video.counterparts.v3', JSON.stringify({ s1: 'vid1', s2: null }));
    _reloadForTests();
    expect(mockMem.has('video.counterparts.v3')).toBe(false);
    expect(useCounterparts.getState().map.s1).toBe('vid1');
    expect('s2' in useCounterparts.getState().map).toBe(false);
  });
});

describe('override and picker', () => {
  it('an override wins over the cache and survives a reload; reset goes back to automatic', async () => {
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([MV]);
    expect(await resolveVideoId(song)).toBe('mvOfficial');
    chooseVideo('song1', 'mine');
    expect(await resolveVideoId(song)).toBe('mine');
    _reloadForTests();
    expect(await resolveVideoId(song)).toBe('mine');
    chooseVideo('song1', 'none');
    expect(await resolveVideoId(song)).toBeNull();
    chooseVideo('song1', null);
    expect(await resolveVideoId(song)).toBe('mvOfficial');
  });

  it('getVideoCandidates serves the cache and recheck runs the chain again', async () => {
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([MV]);
    await resolveVideoId(song);
    const n = (api.searchYtmVideos as jest.Mock).mock.calls.length;
    const c = await getVideoCandidates(song);
    expect(c.current).toBe('mvOfficial');
    expect(c.cands[0].tier).toBe('A');
    expect((api.searchYtmVideos as jest.Mock).mock.calls.length).toBe(n);
    await recheckVideo(song);
    expect((api.searchYtmVideos as jest.Mock).mock.calls.length).toBe(n + 1);
  });

  it('markVideoUnplayable moves to the next tier A candidate, then to none; a user choice is left alone', async () => {
    const MV2 = ytmTrack('mv2', 'Nova - Blue Moon (Official Video)', 'Nova', 4_000_000);
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([MV, MV2]);
    expect(await resolveVideoId(song)).toBe('mvOfficial');
    expect(markVideoUnplayable('song1', 'mvOfficial')).toBe('mv2');
    expect(markVideoUnplayable('song1', 'mv2')).toBeNull();
    chooseVideo('song1', 'mine');
    expect(markVideoUnplayable('song1', 'mine')).toBe('mine');
  });
});

describe('lyric setting', () => {
  it('defaults on and turning it off drops tier B hits and misses', async () => {
    expect(allowLyric()).toBe(true);
    (api.searchYtmVideos as jest.Mock).mockResolvedValue([]);
    (api.searchWebVideos as jest.Mock).mockResolvedValue([LYRIC]);
    expect(await resolveVideoId(song)).toBe('lyr1');
    setAllowLyric(false);
    expect(useCounterparts.getState().map.song1).toBeUndefined();
    expect(await resolveVideoId(song)).toBeNull();
  });
});
