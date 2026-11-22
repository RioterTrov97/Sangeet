import { getDb } from '../db/client';
import { addHistory, playsSince, recentHistory } from '../db/repo';
import type { Track } from '../youtube/models';

export const HISTORY_LIMIT = 50;

/** Most-recent-first list of unique tracks, capped. Pure so it is unit-testable. */
export function pushHistory(list: Track[], track: Track, limit = HISTORY_LIMIT): Track[] {
  return [track, ...list.filter((t) => t.id !== track.id)].slice(0, limit);
}

let cache: Track[] | undefined;
const listeners = new Set<() => void>();

/** Backed by the `history` table (SQLite); the in-memory list is the read cache. */
export function getHistory(): Track[] {
  cache ??= recentHistory(getDb(), HISTORY_LIMIT);
  return cache;
}

export function recordPlayed(track: Track, source?: string): void {
  const cur = getHistory();
  if (cur[0]?.id === track.id) return;
  addHistory(getDb(), track, source);
  cache = pushHistory(cur, track);
  listeners.forEach((l) => l());
}

/** Drops the read cache (after the MMKV import or sign-out). */
export function resetHistoryCache(): void {
  cache = undefined;
  listeners.forEach((l) => l());
}

export function onHistoryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Distinct albums / artists in play order, derived from history. */
export function recentAlbums(tracks: Track[]): { id: string; name: string; artwork: Track['artwork'] }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string; artwork: Track['artwork'] }[] = [];
  for (const t of tracks) {
    if (!t.album?.id || seen.has(t.album.id)) continue;
    seen.add(t.album.id);
    out.push({ id: t.album.id, name: t.album.name, artwork: t.artwork });
  }
  return out;
}

export function recentArtists(tracks: Track[]): { id: string; name: string; artwork: Track['artwork'] }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string; artwork: Track['artwork'] }[] = [];
  for (const t of tracks) {
    const a = t.artists.find((x) => x.id);
    if (!a?.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, name: a.name, artwork: t.artwork });
  }
  return out;
}

/** Every play in the last `days` days (repeats included), for on-device personalisation. */
export function getPlays(days = 30, now = Date.now()) {
  return playsSince(getDb(), now - days * 86_400_000);
}
