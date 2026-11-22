import type { Track } from '../../youtube/models';
import { leadArtist, normalizeTitle, stripArtistPrefix } from '../normalize';
import { parseLrc } from '../lrc';
import type { LyricsProvider } from '../types';

const BASE = 'https://lrclib.net/api';
// Identifies the app only; no personal data. Replace the placeholder URL once the repo is public.
export const LRCLIB_UA = 'Sangeet (https://github.com/sangeet-app/sangeet)';

type LrclibRecord = { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean; plainLyrics?: string | null; syncedLyrics?: string | null };

export const STRICT_TOLERANCE_S = 2;
export const RELAXED_TOLERANCE_S = 5;

/** Picks the closest-duration record within `tolerance` seconds that has lyrics; synced beats plain on ties. */
export function pickMatch(records: LrclibRecord[], durationSec?: number, tolerance = STRICT_TOLERANCE_S): LrclibRecord | undefined {
  const ok = records.filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics) && (durationSec == null || r.duration == null || Math.abs(r.duration - durationSec) <= tolerance));
  return ok.sort((a, b) => {
    const da = durationSec == null ? 0 : Math.abs((a.duration ?? durationSec) - durationSec);
    const db = durationSec == null ? 0 : Math.abs((b.duration ?? durationSec) - durationSec);
    return da - db || Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics);
  })[0];
}

export function toLyrics(r: LrclibRecord) {
  const parsed = r.syncedLyrics ? parseLrc(r.syncedLyrics) : undefined;
  return {
    synced: parsed?.lines.length ? parsed.lines : undefined,
    plain: r.plainLyrics ?? undefined,
    offsetMs: parsed?.offsetMs || undefined,
    durationSec: r.duration || undefined,
  };
}

async function getJson(url: string, signal?: AbortSignal): Promise<any | null> {
  const res = await fetch(url, { headers: { 'User-Agent': LRCLIB_UA }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return res.json();
}

type Fetcher = (url: string, signal?: AbortSignal) => Promise<any | null>;

/**
 * Query order: `get` (title + artist + album + duration), then `search` title + artist, then `q=artist title`, then `q=title`.
 * Every candidate list is first filtered strictly (+-2 s), and only when no query yields a match, relaxed (+-5 s).
 */
export async function findLrclib(track: Track, signal?: AbortSignal, get: Fetcher = getJson): Promise<LrclibRecord | undefined> {
  const artist = leadArtist(track.artists.map((a) => a.name).join(', '));
  const title = stripArtistPrefix(normalizeTitle(track.title), artist);
  const dur = track.durationSec;
  const lists: LrclibRecord[][] = [];
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (track.album?.name) q.set('album_name', normalizeTitle(track.album.name));
  if (dur) q.set('duration', String(Math.round(dur)));
  const exact = await get(`${BASE}/get?${q}`, signal).catch((e) => {
    if (signal?.aborted) throw e;
    return null;
  });
  if (exact) {
    const hit = pickMatch([exact], dur);
    if (hit) return hit;
    lists.push([exact]);
  }
  const searches = [new URLSearchParams({ track_name: title, artist_name: artist }), new URLSearchParams({ q: `${artist} ${title}`.trim() }), new URLSearchParams({ q: title })];
  const seen = new Set<string>();
  for (const s of searches) {
    const url = `${BASE}/search?${s}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const list = (await get(url, signal)) as LrclibRecord[] | null;
    if (!list?.length) continue;
    const hit = pickMatch(list, dur);
    if (hit) return hit;
    lists.push(list);
  }
  for (const l of lists) {
    const hit = pickMatch(l, dur, RELAXED_TOLERANCE_S);
    if (hit) return hit;
  }
  return undefined;
}

export const lrclib: LyricsProvider = {
  id: 'lrclib',
  label: 'LRCLIB',
  async getLyrics(track: Track, signal) {
    const best = await findLrclib(track, signal);
    return best ? toLyrics(best) : null;
  },
};
