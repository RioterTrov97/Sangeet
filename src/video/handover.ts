/** Pure pieces of the audio <-> video handover on TV: the enter/exit state machine, off-screen position estimate, audio health check. */

/** idle = song mode; entering = a video is being prepared / crossfaded in; video = video owns playback; exiting = handing back to audio. */
export type Phase = 'idle' | 'entering' | 'video' | 'exiting';
export type PhaseEvent = 'enter' | 'entered' | 'enter-aborted' | 'exit' | 'exited';

/** Transitions; an event that does not apply leaves the phase alone, so enter and exit can never overlap. */
export function nextPhase(p: Phase, e: PhaseEvent): Phase {
  switch (e) {
    case 'enter':
      return p === 'idle' ? 'entering' : p;
    case 'entered':
      return p === 'entering' ? 'video' : p;
    case 'enter-aborted':
      return p === 'entering' ? 'idle' : p;
    case 'exit':
      return p === 'video' ? 'exiting' : p;
    case 'exited':
      return p === 'exiting' ? 'idle' : p;
  }
}

export const canEnter = (p: Phase): boolean => p === 'idle';

/** What an exit request does in each phase: nothing (already song / already exiting), cancel the pending enter first, or exit now. */
export function exitAction(p: Phase): 'ignore' | 'cancel-then-exit' | 'exit' {
  if (p === 'entering') return 'cancel-then-exit';
  return p === 'video' ? 'exit' : 'ignore';
}

/** Now Playing must have been on screen this long, with no Back pending, before a video is started. */
export const VIDEO_SETTLE_MS = 800;

/** The video position without reading the player: last reported time plus the time since, while it plays (at most `capS` extrapolated). */
export function extrapolateTime(lastTime: number, lastAt: number, now: number, playing: boolean, capS = 1): number {
  if (!playing || !lastAt) return lastTime;
  return lastTime + Math.min(capS, Math.max(0, (now - lastAt) / 1000));
}

/** After the audio was restarted at `expected`: it is fine, is playing from the wrong place (seek), or is not playing at all (reload the item). */
export function audioCheck(state: string, pos: number, expected: number, tolerance = 1.5): 'ok' | 'seek' | 'reload' {
  if (state === 'playing' || state === 'buffering') return pos >= expected - tolerance ? 'ok' : 'seek';
  return 'reload';
}
