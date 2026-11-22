/**
 * Seek hold: after the user seeks, position reports that still carry the pre-seek time (native progress, the video
 * player's timeUpdate, a TV heartbeat) must not reach the store, or the scrubber and lyrics bounce back to the old
 * spot before settling. The hold drops reports until one lands near the target or the hold times out.
 */
export const HOLD_NEAR_S = 1;
export const HOLD_MAX_MS = 1500;
/** Controlling a TV the report has to cross the network and the TV's own seek: hold a little longer. */
export const HOLD_MAX_REMOTE_MS = 2500;

export type SeekHold = { target: number; at: number; maxMs?: number };

/** True when the report should be dropped (still holding); false once it is near the target or the hold expired. */
export function holdDrops(hold: SeekHold | null, pos: number, now: number): boolean {
  if (!hold) return false;
  if (now - hold.at > (hold.maxMs ?? HOLD_MAX_MS)) return false;
  return Math.abs(pos - hold.target) > HOLD_NEAR_S;
}

let current: SeekHold | null = null;

/** Start holding at `target` (call right before the seek is issued). */
export function startSeekHold(target: number, now = Date.now(), maxMs?: number): void {
  current = { target, at: now, ...(maxMs ? { maxMs } : {}) };
}

/** Filter for position reports: true = ignore it. Clears the hold once it is satisfied or expired. */
export function seekHoldDrops(pos: number, now = Date.now()): boolean {
  if (!current) return false;
  if (holdDrops(current, pos, now)) return true;
  current = null;
  return false;
}

export function clearSeekHold(): void {
  current = null;
}

/** True while a seek is still waiting for a position report near its target (the thumb stays where the user put it). */
export function seekHoldActive(now = Date.now()): boolean {
  return !!current && now - current.at <= (current.maxMs ?? HOLD_MAX_MS);
}
