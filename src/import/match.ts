import type { Track } from '../youtube/models';
import type { SpotifyTrack } from './spotify';

/** Lower-case, no diacritics, no "(feat. x)" / "- Remastered 2011" tails, no punctuation. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokens = (s: string) => new Set(normalize(s).split(' ').filter(Boolean));

function titleScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

export const MATCH_THRESHOLD = 0.75;

/** 0..1 for how well a YouTube Music song matches a Spotify track: title 50 %, first artist 30 %, duration (+-5 s) 20 %. */
export function scoreMatch(src: SpotifyTrack, cand: Track): number {
  const title = titleScore(src.title, cand.title);
  if (title < 0.6) return 0;
  const first = normalize(src.artists[0] ?? '');
  const candArtists = cand.artists.map((a) => normalize(a.name)).join(' | ');
  const artist = !first ? 0.5 : candArtists.includes(first) || normalize(cand.title).includes(first) ? 1 : 0;
  let dur = 0.5;
  if (src.durationMs && cand.durationSec) {
    const diff = Math.abs(src.durationMs / 1000 - cand.durationSec);
    dur = diff <= 5 ? 1 : diff <= 10 ? 0.4 : 0;
  }
  return 0.5 * title + 0.3 * artist + 0.2 * dur;
}

/** Best candidate at or above the threshold, else undefined. */
export function bestMatch(src: SpotifyTrack, candidates: Track[]): Track | undefined {
  let best: Track | undefined;
  let top = 0;
  for (const c of candidates) {
    const s = scoreMatch(src, c);
    if (s > top) {
      top = s;
      best = c;
    }
  }
  return top >= MATCH_THRESHOLD ? best : undefined;
}

export type MatchResult = { src: SpotifyTrack; match?: Track };

/** Matches every track with `search` (songs only), `concurrency` at a time, reporting progress; stops early when `signal` aborts. */
export async function matchAll(
  tracks: SpotifyTrack[],
  search: (query: string) => Promise<Track[]>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<MatchResult[]> {
  const out: MatchResult[] = tracks.map((src) => ({ src }));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < tracks.length && !opts.signal?.aborted) {
      const i = next++;
      const src = tracks[i];
      try {
        out[i].match = bestMatch(src, await search(`${src.title} ${src.artists[0] ?? ''}`.trim()));
      } catch {
        // a failed search counts as not found
      }
      opts.onProgress?.(++done, tracks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return out;
}
