/**
 * Guard for the audio <-> video source swap (TV layout changes). While a swap is in flight the outgoing source can
 * still fire completion / track-change events (ExoPlayer ends the released item, the paused audio item reports its
 * end, ...). Those must never advance the queue: the swap keeps the same track and position. After the swap settles,
 * `check` verifies the queue is still on the track we started from and, if not, heals it. Pure state, no imports, so
 * the queue controller and the video controller can both use it and it is unit-testable.
 */
export type Swap = { id: string; index: number; at: number; until: number; started: number };

/** How long a swap protects the queue after it begins (covers HLS load + seek + the audio resume). */
export const SWAP_HOLD_MS = 6000;

let current: Swap | undefined;

export function beginSwap(id: string, index: number, at: number, now = Date.now(), holdMs = SWAP_HOLD_MS): Swap {
  current = { id, index, at, started: now, until: now + holdMs };
  return current;
}

export function endSwap(): void {
  current = undefined;
}

export const activeSwap = (now = Date.now()): Swap | undefined => (current && now < current.until ? current : undefined);

/** True when an event that would advance the queue (video playToEnd, a native track change to another item) must be ignored. */
export const blocksAdvance = (now = Date.now()): boolean => !!activeSwap(now);

/** The native player moved to `id` during a swap: it is a spurious advance when it is not the swapped track. */
export function isSpuriousChange(newId: string, now = Date.now()): boolean {
  const s = activeSwap(now);
  return !!s && newId !== s.id;
}

/** After the swap: true when the queue left the swapped track and must be restored. */
export const needsRestore = (swap: Swap, state: { id?: string; index: number }): boolean => state.id !== swap.id || state.index !== swap.index;

/** Where playback should be after a restore: the swap position plus the time that passed, when it was playing. */
export const restorePosition = (swap: Swap, now: number, wasPlaying: boolean): number => swap.at + (wasPlaying ? Math.max(0, now - swap.started) / 1000 : 0);
