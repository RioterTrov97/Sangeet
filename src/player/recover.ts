/** Tries to resume the same track after a network/source error mid-song before the queue considers skipping it. */
export const MAX_RECOVER_ATTEMPTS = 3;
/** Backoff before attempt 1, 2, 3 (ms). */
export const RECOVER_BACKOFF_MS = [600, 2000, 5000] as const;
/** A track that played this many seconds beyond the last recovery point gets a fresh budget. */
export const RECOVER_RESET_AFTER_S = 20;
/** Failures before the song ever started playing (position below this) are start failures, not mid-song errors. */
export const MIN_STARTED_S = 1;

export type RecoverPlan = { attempt: number; delayMs: number; positionSec: number };

export class RecoverGuard {
  private id: string | undefined;
  private n = 0;
  private lastPos = 0;

  /**
   * A track errored at `positionSec`. Returns the plan for resuming it there, or null when it never started
   * (the caller then skips as before) or the 3 attempts are used up.
   */
  next(trackId: string, positionSec: number): RecoverPlan | null {
    if (!Number.isFinite(positionSec) || positionSec < MIN_STARTED_S) return null;
    if (trackId !== this.id || positionSec - this.lastPos >= RECOVER_RESET_AFTER_S) {
      this.id = trackId;
      this.n = 0;
    }
    if (this.n >= MAX_RECOVER_ATTEMPTS) return null;
    this.lastPos = positionSec;
    this.n++;
    return { attempt: this.n, delayMs: RECOVER_BACKOFF_MS[this.n - 1], positionSec };
  }

  reset(): void {
    this.id = undefined;
    this.n = 0;
    this.lastPos = 0;
  }
}

/** Start failures (the song never played): retries with a fresh stream before giving up on it. Never skips to another song. */
export const START_RETRY_MS = [800, 3000] as const;

export class StartRetry {
  private id: string | undefined;
  private n = 0;

  /** The song `trackId` failed before it started: the delay before the next attempt, or null once the attempts are used up. */
  next(trackId: string): number | null {
    if (trackId !== this.id) {
      this.id = trackId;
      this.n = 0;
    }
    if (this.n >= START_RETRY_MS.length) return null;
    return START_RETRY_MS[this.n++];
  }

  reset(): void {
    this.id = undefined;
    this.n = 0;
  }
}

/** A song counts as finished when it got within this much of its known length (lengths are rounded and tails can be silent). */
export const END_SLACK_S = 15;
/** True when a track at `at` seconds of a `dur`-second song had clearly not reached its end (unknown or short lengths never count). */
export const endedEarly = (at: number, dur: number): boolean => dur > END_SLACK_S * 2 && at < dur - END_SLACK_S;
