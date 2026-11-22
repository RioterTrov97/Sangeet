/**
 * Song <-> video timeline offset: pure helpers (no I/O), unit-tested.
 *
 * Convention: `offset` = seconds the VIDEO's content is later than the SONG's. A moment at song time `t` is at video
 * time `t + offset`. A music video with a 12 s intro has offset +12; a video that cuts the song's own intro has a
 * negative offset. Lyrics are timed to the song, so in video mode a cue's video time is `cue + offset`.
 */
import type { LrcLine } from '../lyrics/types';

/** Song and video this close in length are treated as the same edit (offset 0). */
export const SAME_LENGTH_S = 2;

export const songToVideo = (songSec: number, offset: number): number => songSec + offset;
export const videoToSong = (videoSec: number, offset: number): number => videoSec - offset;

/**
 * Entering video: where the video should start for the song position `songPos`. Inside a video-only intro or a video
 * that has not started the song yet (video time < 0) clamps to the nearest valid point, 0. Past the end clamps too.
 */
export function enterPosition(songPos: number, offset: number, videoDuration?: number): number {
  const t = songToVideo(songPos, offset);
  if (!Number.isFinite(t) || t < 0) return 0;
  if (videoDuration && videoDuration > 1 && t > videoDuration - 0.5) return Math.max(0, videoDuration - 0.5);
  return t;
}

/**
 * Leaving video: where the song should resume for the video position `videoPos`. In a video-only intro (song time < 0)
 * the nearest valid point is the song's start; in a video-only outro it is the end of the song.
 */
export function exitPosition(videoPos: number, offset: number, songDuration?: number): number {
  const t = videoToSong(videoPos, offset);
  if (!Number.isFinite(t) || t < 0) return 0;
  if (songDuration && songDuration > 1 && t > songDuration - 0.5) return Math.max(0, songDuration - 0.5);
  return t;
}

/** Offset 0 when the two recordings are the same length (within SAME_LENGTH_S); undefined when that cannot be said. */
export function offsetFromLengths(songSec: number | undefined, videoSec: number | undefined): 0 | undefined {
  if (!songSec || !videoSec || songSec <= 0 || videoSec <= 0) return undefined;
  return Math.abs(songSec - videoSec) <= SAME_LENGTH_S ? 0 : undefined;
}

/** A video this much longer or shorter than the song, with no offset found, is another cut: song-timed lyrics cannot map onto it as they are. */
export const LYRICS_MAP_LIMIT_S = 20;

/**
 * Another cut of the song (offset unknown, lengths more than LYRICS_MAP_LIMIT_S apart): the factor that stretches the
 * song-timed lyrics over the video's length (video / song), so they scroll through the whole video. They are shown as
 * "May be out of sync". undefined when no stretch applies (offset known, lengths close or unknown).
 */
export function lyricsStretchFor(offsetKnown: boolean, songSec: number | undefined, videoSec: number | undefined): number | undefined {
  if (offsetKnown || !songSec || !videoSec || songSec <= 0 || videoSec <= 0) return undefined;
  return Math.abs(songSec - videoSec) > LYRICS_MAP_LIMIT_S ? videoSec / songSec : undefined;
}

/** Song-timed lyric lines moved onto a video `stretch` times as long (line and word times scaled). */
export function stretchLines<T extends { time: number; words?: { time: number; dur?: number }[] }>(lines: readonly T[], stretch: number): T[] {
  return lines.map((l) => ({ ...l, time: l.time * stretch, ...(l.words ? { words: l.words.map((w) => ({ ...w, time: w.time * stretch, ...(w.dur !== undefined ? { dur: w.dur * stretch } : {}) })) } : {}) }));
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const squash = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

export type LineMatch = { songIndex: number; videoIndex: number; delta: number };

/**
 * Pairs song cue lines with the video's cue lines of the same text, in order (a longest-common-subsequence walk over
 * the normalised texts, so a repeated chorus does not pair with the wrong repeat). `delta` = video time - song time.
 * Lines under 3 characters (empty, "ah", ♪) are not used as anchors.
 */
export function matchLines(song: readonly LrcLine[], video: readonly LrcLine[]): LineMatch[] {
  const a = song.map((l) => squash(l.text));
  const b = video.map((l) => squash(l.text));
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  // dp[i][j] = LCS length of a[i..] and b[j..]; Uint16 is plenty for lyric sizes.
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i].length >= 3 && a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: LineMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].length >= 3 && a[i] === b[j]) {
      out.push({ songIndex: i, videoIndex: j, delta: video[j].time - song[i].time });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

export type OffsetEstimate = { offset: number; /** matched lines that agree with the median (within 0.5 s) */ agree: number; matched: number };

/**
 * Median delta of matched lines, accepted when enough lines matched (>= 4, and at least a third of the shorter list)
 * and most of them agree with the median (>= 70 % within 0.5 s). Otherwise undefined (not trustworthy).
 */
export function estimateFromLines(song: readonly LrcLine[], video: readonly LrcLine[]): OffsetEstimate | undefined {
  const ms = matchLines(song, video);
  const need = Math.max(4, Math.ceil(Math.min(song.length, video.length) / 3));
  if (ms.length < need) return undefined;
  const offset = median(ms.map((x) => x.delta));
  const agree = ms.filter((x) => Math.abs(x.delta - offset) <= 0.5).length;
  if (agree / ms.length < 0.7) return undefined;
  return { offset: Math.round(offset * 100) / 100, agree, matched: ms.length };
}

/** Two cue lists that are the very same lyrics (same record), which say nothing about the video's timing. */
export function sameCues(a: readonly LrcLine[], b: readonly LrcLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.time === b[i].time && l.text === b[i].text);
}

// ---- audio envelope alignment ----

export type Alignment = {
  /** Seconds the video's content is later than the song's (video minus song). */
  lagSec: number;
  /** The weaker of the two windows' correlations at the chosen lag (-1..1). */
  score: number;
  /** How far the chosen lag beats the best lag more than 2 s away (same weaker-window measure). */
  margin: number;
};

/** Zero-mean, unit-variance, with a slow moving average removed so loudness drift does not dominate. */
export function normalizeEnvelope(x: ArrayLike<number>, win = 16): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - win);
    const hi = Math.min(n, i + win + 1);
    out[i] = x[i] - (pre[hi] - pre[lo]) / (hi - lo);
  }
  let v = 0;
  for (let i = 0; i < n; i++) v += out[i] * out[i];
  const sd = Math.sqrt(v / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

/** Pearson correlation of a[i0..i1) with b[i + lag] over the part where both exist; null when under `minN` bins overlap. */
function pearson(a: Float32Array, b: Float32Array, lag: number, i0: number, i1: number, minN: number): number | null {
  const lo = Math.max(i0, -lag);
  const hi = Math.min(i1, b.length - lag);
  const n = hi - lo;
  if (n < minN) return null;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = lo; i < hi; i++) {
    const x = a[i];
    const y = b[i + lag];
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  const d = Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
  return d > 1e-9 ? (sab - (sa * sb) / n) / d : 0;
}

/** Lets a long loop run in slices: resolves a macrotask later so the JS thread can render and handle touch (TV CPUs are slow). */
const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Aligns the song's envelope (its first `windows` x `windowSec`, here 2 x 60 s) with the video's. Each song window is
 * correlated with the video at every lag in [minLagSec, maxLagSec]; a lag's score is the WEAKER window (the true lag
 * matches throughout, a repeated loop or chorus matches only part of the time). Coarse pass on 4-frame sums, then the
 * best few lags are refined on 2-frame sums. `hopSec` is the frame hop of the inputs.
 * The result still has to pass `audioAccepted`: loop-based songs can score the same at several lags.
 */
export async function alignEnvelopes(song: ArrayLike<number>, video: ArrayLike<number>, hopSec: number, minLagSec = -60, maxLagSec = 100, windows = 2, windowSec = 60): Promise<Alignment | undefined> {
  const sum = (x: ArrayLike<number>, k: number) => {
    const out: number[] = [];
    for (let i = 0; i + k <= x.length; i += k) {
      let t = 0;
      for (let j = 0; j < k; j++) t += x[i + j];
      out.push(t);
    }
    return out;
  };
  const stage = async (k: number, lags: number[], minN: number) => {
    const hop = hopSec * k;
    const A = normalizeEnvelope(sum(song, k));
    const B = normalizeEnvelope(sum(video, k));
    const w = Math.round(windowSec / hop);
    const rows: { lag: number; score: number }[] = [];
    let work = 0;
    for (const lag of lags) {
      let m = Infinity;
      for (let q = 0; q < windows; q++) {
        const r = pearson(A, B, lag, q * w, Math.min(A.length, (q + 1) * w), minN);
        if (r === null) {
          m = -Infinity;
          break;
        }
        m = Math.min(m, r);
      }
      if (m > -Infinity) rows.push({ lag, score: m });
      work += w * windows;
      if (work > 300_000) {
        work = 0;
        await yieldNow();
      }
    }
    return { rows, hop };
  };
  const range = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);
  const c = await stage(4, range(Math.floor(minLagSec / (hopSec * 4)), Math.ceil(maxLagSec / (hopSec * 4))), Math.round(20 / (hopSec * 4)));
  if (!c.rows.length) return undefined;
  const order = [...c.rows].sort((a, b) => b.score - a.score);
  const bestCoarse = order[0];
  // Refine the best coarse lag at 2-frame resolution (coarse lag L = 2 L fine bins, +-5 fine bins).
  const centre = bestCoarse.lag * 2;
  const f = await stage(2, range(centre - 5, centre + 5), Math.round(20 / (hopSec * 2)));
  const fine = f.rows.reduce((m, x) => (x.score > m.score ? x : m), { lag: centre, score: -2 });
  const far = Math.round(2 / c.hop);
  const second = order.find((x) => Math.abs(x.lag - bestCoarse.lag) > far)?.score ?? 0;
  return { lagSec: fine.lag * f.hop, score: fine.score, margin: fine.score - Math.max(second, 0) };
}

/** A lag is believed when both windows agree on it (>= 0.45) and it beats every lag 2 s further away by >= 0.1. */
export const audioAccepted = (a: Alignment | undefined): a is Alignment => !!a && a.score >= 0.45 && a.margin >= 0.1;
