import type { Track } from '../youtube/models';

export type OfflineFailurePlan = 'normal' | 'start' | 'continue';

/**
 * What to do when playback fails while offline. A song available offline keeps the normal handling. Any other song stays
 * current and waits for the network (never skipped): `continue` when it had started (shown paused), else `start` (shown loading).
 */
export function offlineFailurePlan(a: { availableOffline: boolean; positionSec: number }): OfflineFailurePlan {
  if (a.availableOffline) return 'normal';
  return a.positionSec >= 1 ? 'continue' : 'start';
}

/** The songs to offer while offline (downloads first, then automatically saved songs, then songs from this iPhone), each once. */
export function offlineSongs(downloaded: readonly Track[], saved: readonly Track[], local: readonly Track[] = []): Track[] {
  const seen = new Set<string>();
  return [...downloaded, ...saved, ...local].filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
}

export type OfflineTopUp = { append: Track[] } | { recycle: Track[] } | null;

/**
 * Offline the related-songs top-up cannot run, so the queue is topped up from the songs saved on this device: the ones not in
 * the queue yet, shuffled. When every saved song is already in it, the saved songs already played (before the current one)
 * go round again: moved to the end, shuffled, so the queue never runs out. null when there is nothing to add.
 */
export function offlineTopUp(queue: readonly Track[], index: number, saved: readonly Track[], rand: () => number = Math.random): OfflineTopUp {
  const have = new Set(queue.map((t) => t.id));
  const fresh = saved.filter((t) => !have.has(t.id));
  if (fresh.length) return { append: shuffled(fresh, rand) };
  const savedIds = new Set(saved.map((t) => t.id));
  const played = queue.slice(0, Math.max(0, index)).filter((t) => savedIds.has(t.id));
  return played.length ? { recycle: shuffled(played, rand) } : null;
}

function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
