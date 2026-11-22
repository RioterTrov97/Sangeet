import type { LrcLine } from '../types';

/** Finds the first value stored under `key` anywhere in a parsed JSON tree. */
function findKey(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 24) return undefined;
  if (key in (node as object)) return (node as Record<string, unknown>)[key];
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** The lyrics tab's browse id (`MPLYt_...`) in a watch-next response. */
export function lyricsBrowseId(next: unknown): string | undefined {
  return /"browseId":"(MPLYt_[^"]+)"/.exec(JSON.stringify(next))?.[1];
}

/**
 * Timed lyrics from a browse response of the YouTube Music Android client (`timedLyricsModel.lyricsData.timedLyricsData`,
 * one entry per line with `cueRange.startTimeMilliseconds`). Returns undefined when the response has none.
 */
export function parseTimedLyrics(browse: unknown): LrcLine[] | undefined {
  const data = findKey(browse, 'timedLyricsData');
  if (!Array.isArray(data)) return undefined;
  const lines = data
    .map((d: { lyricLine?: unknown; cueRange?: { startTimeMilliseconds?: unknown } }) => ({ time: Number(d?.cueRange?.startTimeMilliseconds ?? NaN) / 1000, text: String(d?.lyricLine ?? '').trim() }))
    .filter((l) => Number.isFinite(l.time) && l.time >= 0 && l.text)
    .sort((a, b) => a.time - b.time);
  return lines.length > 1 ? lines : undefined;
}

/** The Android music client sends timed lyrics; the web client does not. Needs no sign-in. */
export const ANDROID_MUSIC = { name: 'ANDROID_MUSIC', version: '7.27.52', ua: 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip' } as const;
export const androidBrowseBody = (browseId: string) => ({ context: { client: { clientName: ANDROID_MUSIC.name, clientVersion: ANDROID_MUSIC.version, hl: 'en', gl: 'US', androidSdkVersion: 34, osName: 'Android', osVersion: '14' } }, browseId });
