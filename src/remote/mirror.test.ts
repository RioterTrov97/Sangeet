import { encode, fromWire, toWire, type ClientMsg, type ServerMsg, type TvSnapshot } from './protocol';
import { applyTick, applyTvState, buildSnapshot, reportsSongTime, songDurationOf, songPositionOf, toPlayingTime } from './mirror';
import { applyStatusHold, DEAD_S, EASE_MS, JUMP_S, reportClock, startStatusHold, stepClock } from './phoneClock';
import { RemoteServer, validPayload } from './server';
import { qualityLabel, tvStatus, videoChip, lyricsChip } from './tvStatus';
import { HOLD_MAX_REMOTE_MS, holdDrops, seekHoldActive, seekHoldDrops, startSeekHold, clearSeekHold } from '../player/seekHold';
import { isVideoLyrics, resolveLayout, showsLyrics, usesVideo } from '../player/layout';
import type { PlayerStoreState } from '../player/store';
import type { Track } from '../youtube/models';

const mk = (id: string, dur = 200): Track => ({ kind: 'track', id, title: `T ${id}`, artists: [{ name: 'A' }], artwork: [], durationSec: dur });
const base: PlayerStoreState = { queue: [mk('a'), mk('b')], index: 0, original: null, shuffle: false, repeat: 'off', status: 'playing', position: 0, duration: 0, userAdded: [], loadingRadio: false };

describe('song-time seek mapping (Blinding Lights 22.6 s, Despacito 21.1 s video offsets)', () => {
  it('music mode: song seconds are the player timeline', () => expect(toPlayingTime(100, false, 22.6, 300)).toBe(100));
  it('video mode: song 100 s is video 122.6 s, and back', () => {
    const v = toPlayingTime(100, true, 22.6, 300);
    expect(v).toBeCloseTo(122.6, 5);
    const snap = buildSnapshot({ ...base, position: v, duration: 300 }, 'video', 'video', 22.6);
    expect(snap.songPosition).toBeCloseTo(100, 5);
    expect(snap.position).toBeCloseTo(122.6, 5);
    expect(snap.songDuration).toBe(200);
  });
  it('a negative offset (video cuts the intro) and an unknown offset (treated as 0, like the TV does)', () => {
    expect(toPlayingTime(50, true, -21.1, 300)).toBeCloseTo(28.9, 5);
    expect(toPlayingTime(50, true, undefined, 300)).toBe(50);
    expect(buildSnapshot({ ...base, position: 60, duration: 300 }, 'video', 'video', undefined).songPosition).toBe(60);
  });
  it('clamps inside a video-only intro and past the end of the song', () => {
    expect(buildSnapshot({ ...base, position: 5, duration: 300 }, 'video', 'video', 22.6).songPosition).toBe(0);
    expect(toPlayingTime(1000, true, 22.6, 300)).toBeCloseTo(299.5, 5);
  });
  it('seek lands on the same song time on both ends (round trip within a frame)', () => {
    for (const off of [22.6, 21.1, -4, 0]) for (const t of [0, 31.4, 120, 199].filter((x) => x + off >= 0)) {
      const snap = buildSnapshot({ ...base, position: toPlayingTime(t, true, off, 400), duration: 400 }, 'video', 'video', off);
      expect(Math.abs((snap.songPosition ?? NaN) - t)).toBeLessThan(0.001);
    }
  });
});

describe('snapshots and ticks with and without the new fields', () => {
  const old: TvSnapshot = { track: null, position: 12, duration: 100, status: 'playing', queue: [], index: 0, mode: 'audio', shuffle: false, repeat: 'off' };
  it('an older TV (no song time): the phone keeps using position / duration', () => {
    expect(reportsSongTime(old)).toBe(false);
    expect(songPositionOf(old)).toBe(12);
    expect(songDurationOf(old)).toBe(100);
    expect(applyTvState(base, old)).toMatchObject({ position: 12, duration: 100 });
    expect(applyTick(base, { position: 3, duration: 100, status: 'playing' })).toMatchObject({ position: 3 });
  });
  it('a new TV: the phone takes song time, not the video timeline', () => {
    const snap = { ...old, mode: 'video' as const, position: 122, duration: 300, songPosition: 100, songDuration: 200 };
    expect(reportsSongTime(snap)).toBe(true);
    expect(applyTvState(base, snap)).toMatchObject({ position: 100, duration: 200 });
    expect(applyTick(base, { position: 123, duration: 300, status: 'playing', songPosition: 101, songDuration: 200 })).toMatchObject({ position: 101, duration: 200 });
  });
  it('carries the mirror fields and drops them when the TV has none', () => {
    const info = { resolvedLayout: 'music' as const, videoId: 'vid', videoTier: 'A' as const, videoKind: 'music' as const, videoState: 'loading' as const, lyrics: { kind: 'synced' as const, offsetMs: 500, uncertain: false, hidden: false }, quality: { video: '1080', audio: 'max' } };
    expect(buildSnapshot(base, 'audio', 'video', undefined, info)).toMatchObject(info);
    expect(buildSnapshot(base, 'audio', 'video')).not.toHaveProperty('videoState');
    expect(buildSnapshot(base, 'audio')).not.toHaveProperty('lyrics');
  });
  it('round-trips through JSON (the wire) unchanged', () => {
    const snap = buildSnapshot(base, 'video', 'videoLyrics', 12, { videoId: null, videoState: 'none' });
    const wire = JSON.parse(JSON.stringify(snap)) as TvSnapshot;
    expect(wire.videoId).toBeNull();
    expect(wire.songPosition).toBeDefined();
    expect(applyTvState(base, wire).queue?.map((t) => fromWire(toWire(t)).id)).toEqual(['a', 'b']);
  });
});

describe('protocol compatibility', () => {
  const handled: ClientMsg[] = [];
  const server = new RemoteServer({ tvId: 't', name: 'TV', handle: (m) => void handled.push(m), snapshot: () => buildSnapshot(base, 'audio') });
  const lines: ServerMsg[] = [];
  const conn = server.accept({ send: (l) => void lines.push(JSON.parse(l) as ServerMsg), close() {} });
  conn.onData(encode({ t: 'hello', v: 1, deviceId: 'p', name: 'P' }));

  it('welcome carries the minor version; ticks carry song time when the snapshot has it', () => {
    expect(lines[0]).toMatchObject({ t: 'welcome', v: 1, minor: 2 });
    server.broadcastTick();
    expect(lines.at(-1)).toMatchObject({ t: 'tick', songPosition: 0, songDuration: 200 });
  });
  it('passes the new commands to the handler, an old phone seek (no song flag) unchanged', () => {
    for (const m of [{ t: 'seek', sec: 5 }, { t: 'seek', sec: 6, song: true }, { t: 'chooseVideo', videoId: 'x', songId: 'a' }, { t: 'chooseVideo', videoId: null }, { t: 'setLyricsOffset', ms: 500 }, { t: 'watchVideo' }]) conn.onData(encode(m as ClientMsg));
    expect(handled).toEqual([{ t: 'seek', sec: 5 }, { t: 'seek', sec: 6, song: true }, { t: 'chooseVideo', videoId: 'x', songId: 'a' }, { t: 'chooseVideo', videoId: null }, { t: 'setLyricsOffset', ms: 500 }, { t: 'watchVideo' }]);
  });
  it('rejects malformed values of the new commands and ignores unknown ones from a newer phone', () => {
    expect(validPayload({ t: 'seek', sec: NaN })).toBe(false);
    expect(validPayload({ t: 'chooseVideo', videoId: 5 as unknown as string })).toBe(false);
    expect(validPayload({ t: 'chooseVideo', videoId: '' })).toBe(false);
    expect(validPayload({ t: 'setLyricsOffset', ms: 'x' as unknown as number })).toBe(false);
    const n = handled.length;
    conn.onData('{"t":"chooseVideo","videoId":7}\n');
    expect(handled.length).toBe(n);
    conn.onData('{"t":"somethingNew","x":1}\n');
    expect(handled.length).toBe(n + 1); // passed through; the TV's switch ignores types it does not know
  });
});

describe('seek hold for a remote seek', () => {
  it('holds up to 2.5 s (longer than local) and drops stale ticks until near the target', () => {
    startSeekHold(100, 0, HOLD_MAX_REMOTE_MS);
    expect(seekHoldActive(100)).toBe(true);
    expect(seekHoldDrops(31, 1800)).toBe(true); // stale tick, 1.8 s later: a local hold would have given up
    expect(seekHoldDrops(100.4, 1900)).toBe(false); // the TV caught up
    expect(seekHoldActive(1900)).toBe(false);
    expect(holdDrops({ target: 100, at: 0, maxMs: HOLD_MAX_REMOTE_MS }, 31, 2600)).toBe(false);
    clearSeekHold();
  });
});

describe('phone clock between TV reports', () => {
  it('advances by elapsed time while playing and stands still when paused', () => {
    expect(stepClock(10, 0, 250, true, 200).pos).toBeCloseTo(10.25, 5);
    expect(stepClock(10, 0, 250, false, 200).pos).toBe(10);
    expect(stepClock(199.9, 0, 1000, true, 200).pos).toBe(200);
  });
  it('ignores a small drift, eases a medium one over ~0.5 s, jumps on a big one, a seek, a track change or a pause', () => {
    expect(reportClock(10, 10 + DEAD_S - 0.01, true, false)).toEqual({ pos: 10, corr: 0 });
    const e = reportClock(10, 11, true, false);
    expect(e).toEqual({ pos: 10, corr: 1 });
    expect(reportClock(10, 10 + JUMP_S + 1, true, false)).toEqual({ pos: 12.5, corr: 0 });
    expect(reportClock(10, 10.7, true, true)).toEqual({ pos: 10.7, corr: 0 });
    expect(reportClock(10, 10.7, false, false)).toEqual({ pos: 10.7, corr: 0 });
    let c = { pos: 10, corr: 1 };
    let last = c.pos;
    for (let t = 0; t < EASE_MS; t += 50) {
      c = stepClock(c.pos, c.corr, 50, false, 0);
      expect(c.pos).toBeGreaterThanOrEqual(last); // never steps backwards
      last = c.pos;
    }
    expect(c.pos).toBeGreaterThan(10.6);
    expect(c.pos).toBeLessThan(11.01);
  });
  it('eases backwards drift without a backwards jump of more than the correction rate', () => {
    const r = stepClock(10, -0.8, 100, true, 0);
    expect(r.pos).toBeCloseTo(10 + 0.1 - 0.16, 5);
  });
});

describe('optimistic play / pause then TV truth', () => {
  const t0 = 1000;
  it('shows the requested state while a stale report arrives, then the TV once it agrees or the hold ends', () => {
    const hold = startStatusHold(true, t0);
    expect(applyStatusHold(hold, 'paused', t0 + 300)).toEqual({ status: 'playing', hold });
    expect(applyStatusHold(hold, 'buffering', t0 + 600)).toEqual({ status: 'buffering', hold: null });
    expect(applyStatusHold(hold, 'paused', t0 + 2500)).toEqual({ status: 'paused', hold: null });
    expect(applyStatusHold(null, 'paused', t0)).toEqual({ status: 'paused', hold: null });
  });
});

describe('the "On TV" status model', () => {
  it('video chip: kind, none, looking, loading, failed', () => {
    expect(videoChip('v', 'music', 'playing')).toMatchObject({ icon: 'music', label: 'Music video', spinner: false });
    expect(videoChip('v', 'lyric', 'none').label).toBe('Lyric video');
    expect(videoChip('v', 'upload', 'none').label).toBe('Upload');
    expect(videoChip(null, undefined, 'none')).toMatchObject({ icon: 'none', label: 'No video' });
    expect(videoChip(undefined, undefined, undefined).spinner).toBe(true);
    expect(videoChip('v', 'music', 'loading').spinner).toBe(true);
    expect(videoChip('v', 'music', 'failed').icon).toBe('failed');
  });
  it('lyrics chip: synced, offset, may be out of sync, plain, none, hidden, loading', () => {
    const l = (o: Partial<{ kind: 'synced' | 'plain' | 'none' | 'loading'; offsetMs: number; uncertain: boolean; hidden: boolean }>) => ({ kind: 'synced' as const, offsetMs: 0, uncertain: false, hidden: false, ...o });
    expect(lyricsChip(l({}))).toMatchObject({ icon: 'synced', label: 'Synced' });
    expect(lyricsChip(l({ offsetMs: 1000 })).label).toBe('Sync +1.0 s');
    expect(lyricsChip(l({ uncertain: true }))).toMatchObject({ icon: 'unsure', label: 'May be out of sync' });
    expect(lyricsChip(l({ kind: 'plain' })).icon).toBe('plain');
    expect(lyricsChip(l({ kind: 'none' })).dim).toBe(true);
    expect(lyricsChip(l({ hidden: true })).icon).toBe('hidden');
    expect(lyricsChip(l({ kind: 'loading' })).spinner).toBe(true);
  });
  it('layout shown is what the TV resolved, else its saved layout; quality follows what is on screen', () => {
    expect(tvStatus('video', { resolvedLayout: 'music' }).layout).toBe('music');
    expect(tvStatus('lyrics', undefined).layout).toBe('lyrics');
    expect(tvStatus(undefined, undefined).layout).toBe('music');
    expect(qualityLabel({ video: '1080', audio: 'max' }, true)).toBe('1080p');
    expect(qualityLabel({ video: '1080', audio: 'high' }, false)).toBe('High');
    expect(qualityLabel(undefined, false)).toBeUndefined();
  });
});

describe('the shared layout model (src/player/layout)', () => {
  it('resolves and classifies layouts the way the TV does', () => {
    expect(resolveLayout('video', false, 'synced')).toBe('music');
    expect(resolveLayout('videoLyrics', true, 'none')).toBe('video');
    expect(usesVideo('videoLyricsOverlay') && isVideoLyrics('videoLyricsOverlay') && showsLyrics('lyrics')).toBe(true);
  });
});
