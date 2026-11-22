/**
 * One step of the playback clock. `rebase` (a fresh store position) wins; otherwise the clock advances by the frame
 * delta while playing and stands still while paused/buffering. Pure so it is unit-tested; also runs as a worklet.
 */
export function stepClock(pos: number, playing: boolean, dtMs: number, rebaseTo: number | null): number {
  'worklet';
  if (rebaseTo !== null) return rebaseTo;
  if (!playing) return pos;
  // A frame hiccup (app backgrounded, debugger pause) must not fling the lyrics forward.
  return pos + Math.min(Math.max(dtMs, 0), 250) / 1000;
}


/** Audio counts as stalled when the player says "playing" but its reported position has not moved for this long. */
export const STALL_MS = 1500;

/** True when the store position has been flat for STALL_MS while status is "playing" (nothing is actually sounding). */
export function isStalled(nowMs: number, lastAdvanceAtMs: number): boolean {
  return nowMs - lastAdvanceAtMs > STALL_MS;
}

/** Lines light this much before their LRC timestamp so they land as the word is sung (render + scroll latency). */
export const LOOKAHEAD_MS = 150;
/** A correction smaller than this is eased in over EASE_MS; a larger one is a seek and snaps. */
export const EASE_MS = 300;
export const SNAP_REMOTE_S = 1.5;
export const SNAP_LOCAL_S = 0.6;

export type ClockState = { pos: number; corr: number };

/**
 * One frame of the eased clock. `measured` is a fresh position report (player store tick or TV heartbeat): when it
 * disagrees with the extrapolated clock by less than `snapS` the difference is folded in gradually over EASE_MS (no
 * visible jump, no backwards step), otherwise it is a seek and the clock snaps. Between reports the clock advances by
 * the frame delta while `playing`. Pure; runs as a worklet.
 */
export function stepEased(s: ClockState, playing: boolean, dtMs: number, measured: number | null, snapS: number): ClockState {
  'worklet';
  let { pos, corr } = s;
  if (measured !== null) {
    const drift = measured - pos;
    if (Math.abs(drift) > snapS) return { pos: measured, corr: 0 };
    corr = drift;
  }
  const dt = Math.min(Math.max(dtMs, 0), 250);
  const k = Math.min(1, dt / EASE_MS);
  const eased = corr * k;
  return { pos: pos + (playing ? dt / 1000 : 0) + eased, corr: corr - eased };
}

/** Index of the active line at `pos` seconds (last time <= pos), -1 before the first. */
export function findActive(times: readonly number[], pos: number): number {
  'worklet';
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** TV side: the position to put in a heartbeat. The store updates ~4x/s, so while playing extrapolate from its last update (capped). */
export function heartbeatPosition(position: number, playing: boolean, sinceUpdateMs: number): number {
  return playing ? position + Math.min(Math.max(sinceUpdateMs, 0), 500) / 1000 : position;
}
