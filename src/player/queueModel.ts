import type { Track } from '../youtube/models';

/** Pure queue operations (no native calls) so the logic is unit-testable. Tracks are unique by id. */

export const RADIO_THRESHOLD = 3;

export function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function insertNext(queue: Track[], index: number, track: Track): { queue: Track[]; index: number } {
  const current = queue[index];
  if (!current) return { queue: [track], index: 0 };
  if (current.id === track.id) return { queue, index };
  const without = queue.filter((t) => t.id !== track.id);
  const at = without.findIndex((t) => t.id === current.id);
  const next = [...without.slice(0, at + 1), track, ...without.slice(at + 1)];
  return { queue: next, index: at };
}

export function append(queue: Track[], tracks: Track[]): Track[] {
  const have = new Set(queue.map((t) => t.id));
  return [...queue, ...dedupe(tracks).filter((t) => !have.has(t.id))];
}

export function removeAt(queue: Track[], index: number, at: number): { queue: Track[]; index: number } {
  if (at < 0 || at >= queue.length || at === index) return { queue, index };
  const next = queue.filter((_, i) => i !== at);
  return { queue: next, index: at < index ? index - 1 : index };
}

export function move(queue: Track[], index: number, from: number, to: number): { queue: Track[]; index: number } {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return { queue, index };
  const currentId = queue[index]?.id;
  const next = queue.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return { queue: next, index: Math.max(0, next.findIndex((t) => t.id === currentId)) };
}

export function clearUpcoming(queue: Track[], index: number): Track[] {
  return queue.slice(0, index + 1);
}

/** Fisher-Yates over the tracks after the current one; the current track becomes index 0 of the result's "rest". */
export function shuffleKeepingCurrent(queue: Track[], index: number, rand: () => number = Math.random): { queue: Track[]; index: number } {
  const current = queue[index];
  if (!current) return { queue, index };
  const rest = queue.filter((_, i) => i !== index);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { queue: [current, ...rest], index: 0 };
}

/** Restores the pre-shuffle order, keeping tracks added since (appended) after the original ones. */
export function unshuffle(queue: Track[], original: Track[]): { queue: Track[]; currentId?: string } {
  const present = new Set(queue.map((t) => t.id));
  const base = original.filter((t) => present.has(t.id));
  const extra = queue.filter((t) => !original.some((o) => o.id === t.id));
  return { queue: [...base, ...extra] };
}

export function upcomingCount(queue: Track[], index: number): number {
  return Math.max(0, queue.length - index - 1);
}

/**
 * Songs to seed related-song radio from, best first: the last queued song (continues where the queue ends), the current
 * one, then the rest from the end backwards. Each id once, at most `max`.
 */
export function radioSeeds(queue: Track[], index: number, max = 4): Track[] {
  const order = [queue[queue.length - 1], queue[index], ...[...queue].reverse()];
  const seen = new Set<string>();
  return order.filter((t): t is Track => !!t && !seen.has(t.id) && (seen.add(t.id), true)).slice(0, max);
}

export function needsRadio(queue: Track[], index: number, repeat: 'off' | 'all' | 'one'): boolean {
  return repeat === 'off' && queue.length > 0 && upcomingCount(queue, index) < RADIO_THRESHOLD;
}
