/**
 * Playback-intent state machine. "Intent" means the user asked for playback recently (a load, skip or
 * play), so a native pause right after it is a stall-after-load glitch we should nudge past.
 * Any pause attributable to the user or the system (in-app pause, CarPlay / lock screen / steering wheel
 * / AirPods remote command, audio interruption) cancels the intent so it is never overridden.
 */
export type CancelReason = 'user' | 'remote' | 'interruption';

export const INTENT_WINDOW_MS = 12_000;

export class PlaybackIntent {
  private until = 0;
  /** Bumped by every cancel, so a running resume loop can tell it was cancelled. */
  private epoch = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** The user (or an auto-advance of playing audio) wants sound: open or extend the window. */
  request(): void {
    this.until = this.now() + INTENT_WINDOW_MS;
  }

  /** A pause or stop the user or system caused. Closes the window. */
  cancel(_reason: CancelReason): void {
    this.until = 0;
    this.epoch++;
  }

  active(): boolean {
    return this.now() < this.until;
  }

  /** Snapshot for a loop: `cancelledSince(token)` is true once cancel() ran after it was taken. */
  token(): number {
    return this.epoch;
  }
  cancelledSince(token: number): boolean {
    return this.epoch !== token;
  }

  /** Whether a native `paused` event should be answered with a resume. */
  shouldResumeOnPause(): boolean {
    return this.active();
  }
}

export const intent = new PlaybackIntent();
