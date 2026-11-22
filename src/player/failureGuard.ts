/** Consecutive playback failures before the queue stops skipping and waits for the user. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Stops the skip cascade: when resolves fail (offline, blocked edge, ...), skipping to the next track fails too and
 * the queue would race through ~20 tracks in seconds. After 3 failures in a row we halt on the failing track.
 */
export class FailureGuard {
  private n = 0;

  /** A track failed to play. `halt` once the limit is reached (the count resets so a retry gets a fresh budget). */
  failed(): { halt: boolean; count: number } {
    this.n++;
    if (this.n >= MAX_CONSECUTIVE_FAILURES) {
      const count = this.n;
      this.n = 0;
      return { halt: true, count };
    }
    return { halt: false, count: this.n };
  }

  /** Audio actually played, or the user started something deliberately. */
  reset(): void {
    this.n = 0;
  }
}
