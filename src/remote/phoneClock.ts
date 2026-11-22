import type { PlayStatus } from './protocol';

/**
 * The phone's playback clock while it mirrors a TV. The TV is the authority and reports once a second; between reports the
 * phone advances the position itself, and a report that disagrees by a little is folded in over EASE_MS (no jump, no step back).
 * Only a seek, a track change, a pause or a big disagreement jumps. Pure; the store position is the clock, `corr` the correction still to apply.
 */
export const EASE_MS = 500;
/** Disagreement up to this is ignored (the clocks just differ by network and rounding). */
export const DEAD_S = 0.5;
/** Disagreement beyond this is somebody seeking (on the TV, or a stale position): jump. */
export const JUMP_S = 1.5;

export type ClockOut = { pos: number; corr: number };

/** A TV report (`reported` song seconds) against the phone's current position `pos`. */
export function reportClock(pos: number, reported: number, playing: boolean, jump: boolean): ClockOut {
  const drift = reported - pos;
  if (jump || !playing || Math.abs(drift) > JUMP_S) return { pos: reported, corr: 0 };
  if (Math.abs(drift) > DEAD_S) return { pos, corr: drift };
  return { pos, corr: 0 };
}

/** One timer step: advance by `dtMs` while playing and fold in the pending correction. `duration` > 0 caps the position. */
export function stepClock(pos: number, corr: number, dtMs: number, playing: boolean, duration: number): ClockOut {
  const dt = Math.min(Math.max(dtMs, 0), 1000);
  const eased = corr * Math.min(1, dt / EASE_MS);
  let next = pos + (playing ? dt / 1000 : 0) + eased;
  if (duration > 0) next = Math.min(next, duration);
  return { pos: Math.max(0, next), corr: corr - eased };
}

/** An optimistic play / pause: the phone shows what the user asked for until the TV agrees or `until` passes. */
export type StatusHold = { on: boolean; until: number } | null;
export const HOLD_STATUS_MS = 2000;
export const isOn = (s: PlayStatus): boolean => s === 'playing' || s === 'buffering';

export const startStatusHold = (on: boolean, now: number, ms = HOLD_STATUS_MS): StatusHold => ({ on, until: now + ms });

/** The status to show for a TV report, and the hold to keep. */
export function applyStatusHold(hold: StatusHold, reported: PlayStatus, now: number): { status: PlayStatus; hold: StatusHold } {
  if (!hold || now > hold.until || isOn(reported) === hold.on) return { status: reported, hold: null };
  return { status: hold.on ? 'playing' : 'paused', hold };
}
