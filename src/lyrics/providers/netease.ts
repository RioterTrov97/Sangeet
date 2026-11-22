import type { Track } from '../../youtube/models';
import { artistMatches, pickByDuration, titleKeys, titleMatches } from '../match';
import { parseLrc } from '../lrc';
import { leadArtist, normalizeTitle, stripArtistPrefix } from '../normalize';
import type { LyricsProvider } from '../types';

const BASE = 'https://music.163.com/api';
const HEADERS = { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36' };

export type NeteaseSong = { id?: number; name?: string; duration?: number; artists?: { name?: string }[] };

/** Strict choice among search results: title equal/contained, artist present, duration +-2 s then +-5 s. */
export function pickNetease(songs: NeteaseSong[], track: Track): NeteaseSong | undefined {
  const keys = titleKeys(track);
  const ok = songs.filter((s) => s.id && titleMatches(s.name ?? '', keys) && artistMatches((s.artists ?? []).map((a) => a.name ?? '').join(', '), track));
  return pickByDuration(ok.map((s) => ({ s, durationSec: s.duration ? s.duration / 1000 : undefined })), track.durationSec)?.s;
}

/** Instrumental marker NetEase puts in place of lyrics, or nothing at all. */
export function isEmptyNeteaseLyric(lrc: string | undefined | null): boolean {
  const text = (lrc ?? '').replace(/\[[^\]]*\]/g, '').trim();
  return !text || (text.includes('纯音乐') && text.length < 60);
}

async function getJson(url: string, signal?: AbortSignal): Promise<any | null> {
  const res = await fetch(url, { headers: HEADERS, signal });
  if (!res.ok) throw new Error(`NetEase HTTP ${res.status}`);
  return res.json();
}

export const netease: LyricsProvider = {
  id: 'netease',
  label: 'NetEase',
  async getLyrics(track: Track, signal) {
    const artist = leadArtist(track.artists.map((a) => a.name).join(', '));
    const title = stripArtistPrefix(normalizeTitle(track.title), artist);
    const search = await getJson(`${BASE}/search/get?${new URLSearchParams({ s: `${title} ${artist}`.trim(), type: '1', limit: '10' })}`, signal);
    const songs: NeteaseSong[] = search?.result?.songs ?? [];
    // Every acceptable result is tried in turn: a catalogue match with an empty lyric must not hide the next one.
    const cands = songs.filter((s) => pickNetease([s], track));
    const first = pickNetease(songs, track);
    const order = first ? [first, ...cands.filter((s) => s !== first)] : [];
    for (const song of order.slice(0, 3)) {
      const res = await getJson(`${BASE}/song/lyric?${new URLSearchParams({ id: String(song.id), lv: '1', kv: '1', tv: '-1' })}`, signal);
      const lrc: string | undefined = res?.lrc?.lyric; // tlyric (translation) and romalrc are ignored
      if (isEmptyNeteaseLyric(lrc)) continue;
      const parsed = parseLrc(lrc!);
      if (parsed.lines.length < 2) continue;
      return { synced: parsed.lines, offsetMs: parsed.offsetMs || undefined, durationSec: song.duration ? song.duration / 1000 : undefined };
    }
    return null;
  },
};
