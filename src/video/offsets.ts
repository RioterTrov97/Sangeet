import { create } from 'zustand';

import { getLyrics } from '../lyrics';
import type { LrcLine, Lyrics } from '../lyrics/types';
import { log, logWarn } from '../util/log';
import { getJson, setJson } from '../util/storage';
import type { Track } from '../youtube/models';
import { fetchEnvelope, type Envelope } from './audioEnvelope';
import { alignEnvelopes, audioAccepted, estimateFromLines, offsetFromLengths, sameCues, type Alignment } from './timeline';

/**
 * One song <-> video timeline offset per (songId, videoId), in seconds the video's content is later than the song's
 * (see timeline.ts). Decided once, cached for good (an upload's timeline never changes):
 *   self    the track is itself the video                           0
 *   length  song and video within 2 s of each other                 0
 *   audio   alignment of the AAC frame-size envelopes of the first two minutes of each stream
 *   lyrics  median delta of matching cue lines (LRCLIB lyrics timed for the video's length vs the song's)
 * Nothing found: no entry, the lyrics stay synced and are flagged "may be out of sync".
 */
export type OffsetMethod = 'self' | 'length' | 'lyrics' | 'audio';
export type OffsetEntry = { offset: number; method: OffsetMethod; at: number; detail?: string };

const KEY = 'video.offsets.v1';
const known: Record<string, OffsetEntry> = getJson<Record<string, OffsetEntry>>(KEY) ?? {};
export const useOffsets = create<{ map: Record<string, OffsetEntry> }>(() => ({ map: { ...known } }));

export const offsetKey = (songId: string, videoId: string) => `${songId}|${videoId}`;
export const knownOffset = (songId: string, videoId: string | null | undefined): OffsetEntry | undefined => (videoId ? known[offsetKey(songId, videoId)] : undefined);

function remember(songId: string, videoId: string, e: OffsetEntry) {
  known[offsetKey(songId, videoId)] = e;
  setJson(KEY, known);
  useOffsets.setState({ map: { ...known } });
}

// ---- the decision pipeline (dependencies injected so it is unit-tested and the research harness can run every method) ----

export type Deps = {
  videoDuration: (videoId: string) => Promise<number | undefined>;
  /** Timed lyrics of a recording by its own id (the song's, or the video's: LRCLIB entries are picked by that recording's length). */
  lyrics: (track: Track) => Promise<Lyrics | null>;
  envelope: (id: string, seconds: number) => Promise<Envelope>;
};

export type Step = { method: Exclude<OffsetMethod, 'self'>; offset?: number; detail: string; ms: number };
export type Outcome = { entry?: OffsetEntry; steps: Step[] };

/** The song's first two minutes (two 60 s windows) against the video's first 220 s (room for a video-only intro up to ~100 s). */
export const SONG_WINDOW_S = 120;
export const VIDEO_WINDOW_S = 220;

async function timed<T>(f: () => Promise<T>): Promise<[T | undefined, number, unknown]> {
  const t0 = Date.now();
  try {
    return [await f(), Date.now() - t0, undefined];
  } catch (e) {
    return [undefined, Date.now() - t0, e];
  }
}

export async function audioOffset(song: Track, videoId: string, deps: Pick<Deps, 'envelope'>): Promise<{ c?: Alignment; bytes: number; requests: number; ms: number }> {
  const t0 = Date.now();
  const [s, v] = await Promise.all([deps.envelope(song.id, SONG_WINDOW_S), deps.envelope(videoId, VIDEO_WINDOW_S)]);
  const c = await alignEnvelopes(s.sizes, v.sizes, s.hopSec);
  return { c, bytes: s.bytes + v.bytes, requests: s.requests + v.requests, ms: Date.now() - t0 };
}

/** The video's lyric record is only trusted when it is LRCLIB's entry timed for a recording of the video's length (YouTube's lyrics for a video id are the song's). */
const lyricsOfRecording = (l: Lyrics | null, lengthSec: number | undefined, needLength: boolean): LrcLine[] | undefined => {
  if (!l?.synced?.length) return undefined;
  if (l.providerId === 'lrclib') return l.durationSec && lengthSec && Math.abs(l.durationSec - lengthSec) <= 3 ? l.synced : undefined;
  return needLength ? undefined : l.synced; // YouTube Music timed lyrics follow the song
};

/**
 * Runs the methods best first and stops at the first that answers; `all` runs every method regardless (research).
 * The video is a different recording from the song only when the lengths are not within 2 s.
 */
export async function decideOffset(song: Track, videoId: string, deps: Deps, opts: { all?: boolean } = {}): Promise<Outcome> {
  const steps: Step[] = [];
  let entry: OffsetEntry | undefined;
  const at = Date.now();
  const done = (e: OffsetEntry) => {
    entry ??= e;
    return !opts.all;
  };

  const vdur = await deps.videoDuration(videoId).catch(() => undefined);
  const byLength = offsetFromLengths(song.durationSec, vdur);
  steps.push({ method: 'length', offset: byLength, detail: `song ${song.durationSec ?? '?'} s, video ${vdur ?? '?'} s`, ms: 0 });
  if (byLength !== undefined && done({ offset: 0, method: 'length', at })) return { entry, steps };

  // 1. Audio envelope alignment (measured within 0.02 s of a waveform comparison).
  const [ares, ams, aerr] = await timed(() => audioOffset(song, videoId, deps));
  if (ares && audioAccepted(ares.c)) {
    const c = ares.c;
    const offset = Math.round(c.lagSec * 100) / 100;
    steps.push({ method: 'audio', offset, detail: `score ${c.score.toFixed(2)} margin ${c.margin.toFixed(2)}, ${ares.bytes} B / ${ares.requests} req`, ms: ams });
    if (done({ offset, method: 'audio', at, detail: `score ${c.score.toFixed(2)} margin ${c.margin.toFixed(2)}` })) return { entry, steps };
  } else steps.push({ method: 'audio', detail: aerr ? `failed: ${aerr instanceof Error ? aerr.message : aerr}` : ares?.c ? `rejected (best lag ${ares.c.lagSec.toFixed(2)} score ${ares.c.score.toFixed(2)} margin ${ares.c.margin.toFixed(2)})` : 'no overlap', ms: ams });
  // 2. Lyrics cue alignment (coarser: two lyric authors time lines up to ~1 s apart; used when the audio is ambiguous).
  const [lres, lms, lerr] = await timed(async () => {
    const [a, b] = await Promise.all([deps.lyrics(song), deps.lyrics({ ...song, id: videoId, durationSec: vdur ?? song.durationSec, isVideo: true })]);
    const sa = lyricsOfRecording(a, song.durationSec, false);
    const sb = lyricsOfRecording(b, vdur, true);
    if (!sa?.length || !sb?.length) return { why: `no synced lyrics timed for ${!sa?.length ? 'the song' : `the video's ${vdur ?? '?'} s`}` };
    if (sameCues(sa, sb)) return { why: 'the video got the very same lyric record' };
    const est = estimateFromLines(sa, sb);
    return est ? { est } : { why: 'lines did not match consistently' };
  });
  if (lres && 'est' in lres && lres.est) {
    steps.push({ method: 'lyrics', offset: lres.est.offset, detail: `${lres.est.agree}/${lres.est.matched} lines agree`, ms: lms });
    if (done({ offset: lres.est.offset, method: 'lyrics', at, detail: `${lres.est.agree}/${lres.est.matched} lines` })) return { entry, steps };
  } else steps.push({ method: 'lyrics', detail: lerr ? `failed: ${lerr instanceof Error ? lerr.message : lerr}` : (lres as { why: string }).why, ms: lms });

  return { entry, steps };
}

// ---- app wiring ----

const DUR_KEY = 'video.durations.v1';
const durations: Record<string, number> = getJson<Record<string, number>>(DUR_KEY) ?? {};
/** Remembers a video's length (search results and the video player know it). */
export function noteVideoDuration(videoId: string, sec: number | undefined): void {
  if (!sec || sec <= 0 || durations[videoId] === Math.round(sec)) return;
  durations[videoId] = Math.round(sec);
  const keys = Object.keys(durations);
  if (keys.length > 1500) delete durations[keys[0]];
  setJson(DUR_KEY, durations);
}

let realDeps: Deps | undefined;
async function appDeps(): Promise<Deps> {
  if (realDeps) return realDeps;
  const { audioFileUrl, resolver } = await import('../player/proxy');
  realDeps = {
    videoDuration: async (id) => {
      if (durations[id]) return durations[id];
      const s = await resolver.resolve(id);
      noteVideoDuration(id, s.durationMs ? s.durationMs / 1000 : undefined);
      return durations[id];
    },
    lyrics: (t) => getLyrics(t),
    envelope: (id, seconds) => fetchEnvelope(audioFileUrl(id), seconds, 'moof'),
  };
  return realDeps;
}

const inflight = new Map<string, Promise<OffsetEntry | undefined>>();
const failedAt = new Map<string, number>();
const RETRY_MS = 10 * 60_000;

/**
 * The offset for this pair: cached, else decided now (concurrent callers share one run). Undefined when no method could
 * tell; that is retried after 10 minutes. Tracks that are themselves the video are 0 without any work.
 */
export function ensureOffset(song: Track, videoId: string, deps?: Deps): Promise<OffsetEntry | undefined> {
  if (song.id === videoId) return Promise.resolve({ offset: 0, method: 'self', at: 0 });
  const k = offsetKey(song.id, videoId);
  if (known[k]) return Promise.resolve(known[k]);
  if ((failedAt.get(k) ?? 0) > Date.now() - RETRY_MS) return Promise.resolve(undefined);
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      try {
        const out = await decideOffset(song, videoId, deps ?? (await appDeps()));
        log('offset', `${song.id}|${videoId}: ${out.entry ? `${out.entry.offset.toFixed(2)} s via ${out.entry.method}` : 'unknown'} [${out.steps.map((s) => `${s.method}:${s.offset ?? '-'} ${s.ms}ms (${s.detail})`).join('; ')}]`);
        if (out.entry) remember(song.id, videoId, out.entry);
        else failedAt.set(k, Date.now());
        return out.entry;
      } catch (e) {
        logWarn('offset', `failed for ${k}`, e instanceof Error ? e.message : e);
        failedAt.set(k, Date.now());
        return undefined;
      }
    })().finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

/** Offset in seconds when known (0 for the song itself); undefined when it is not (yet) known. */
export function offsetSec(songId: string, videoId: string | null | undefined): number | undefined {
  if (!videoId) return undefined;
  if (songId === videoId) return 0;
  return known[offsetKey(songId, videoId)]?.offset;
}
