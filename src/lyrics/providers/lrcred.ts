import type { Track } from '../../youtube/models';
import { artistMatches, pickByDuration, titleKeys, titleMatches } from '../match';
import { leadArtist, normalizeTitle, stripArtistPrefix } from '../normalize';
import { parseTtml } from '../ttml';
import type { LyricsProvider } from '../types';

const BASE = 'https://lrc.red/api/v1';
const UA = 'Sangeet (https://github.com/sangeet-app/sangeet)';

export type LrcRedHit = { track_name?: string; artist_name?: string; duration?: number; lyricsUrl?: string; timing_type?: string };

/** Strict choice among search hits: title equal/contained, lead artist present, duration +-2 s then +-5 s, timed lyrics only. */
export function pickLrcRed(results: LrcRedHit[], track: Track): LrcRedHit | undefined {
  const keys = titleKeys(track);
  const ok = results.filter((r) => r.lyricsUrl && r.timing_type !== 'none' && titleMatches(r.track_name ?? '', keys) && artistMatches(r.artist_name ?? '', track));
  const rank = (r: LrcRedHit) => (r.timing_type === 'word' ? 0 : 1);
  const best = pickByDuration(ok.map((r) => ({ r, durationSec: r.duration })), track.durationSec);
  if (!best) return undefined;
  // among equally acceptable hits prefer word-timed
  const same = ok.filter((r) => track.durationSec == null || (r.duration != null && Math.abs(r.duration - best.durationSec!) < 0.5));
  return same.sort((a, b) => rank(a) - rank(b))[0] ?? best.r;
}

async function getText(url: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrc.red HTTP ${res.status}`);
  return res.text();
}

export const lrcred: LyricsProvider = {
  id: 'lrcred',
  label: 'lrc.red',
  async getLyrics(track: Track, signal) {
    const artist = leadArtist(track.artists.map((a) => a.name).join(', '));
    const title = stripArtistPrefix(normalizeTitle(track.title), artist);
    const body = await getText(`${BASE}?${new URLSearchParams({ track: title, artist })}`, signal);
    if (!body) return null;
    const hit = pickLrcRed((JSON.parse(body)?.results as LrcRedHit[] | undefined) ?? [], track);
    if (!hit?.lyricsUrl || !/^https:\/\/lrc\.red\//.test(hit.lyricsUrl)) return null;
    const ttml = await getText(hit.lyricsUrl, signal);
    if (!ttml) return null;
    const parsed = parseTtml(ttml);
    if (parsed.lines.length < 2) return null;
    return { synced: parsed.lines, durationSec: hit.duration || parsed.durationSec };
  },
};
