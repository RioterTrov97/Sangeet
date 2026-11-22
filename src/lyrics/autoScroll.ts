/**
 * Unsynced lyrics follow the song: the scroll position is a straight line from the first line (after the intro) to the
 * last (before the outro) over the song's length. A manual scroll is kept as a per-song correction added to that line,
 * so after the pause the lyrics carry on from where the user left them at the same pace. Pure; also runs as a worklet.
 */
export const AUTO_FROM = 0.08;
export const AUTO_TO = 0.95;
/** After a touch the auto-scroll stays off this long. */
export const AUTO_PAUSE_MS = 4000;

/** Scroll offset (0..maxY) for the song at `pos` of `dur` seconds, before any correction. */
export function baseScroll(pos: number, dur: number, maxY: number): number {
  'worklet';
  if (!(dur > 0) || !(maxY > 0) || !Number.isFinite(pos)) return 0;
  const f = (pos / dur - AUTO_FROM) / (AUTO_TO - AUTO_FROM);
  return maxY * Math.min(1, Math.max(0, f));
}

/** The offset to show: the base line plus the user's correction, kept inside the content. */
export function autoScroll(pos: number, dur: number, maxY: number, correction: number): number {
  'worklet';
  return Math.min(Math.max(0, maxY), Math.max(0, baseScroll(pos, dur, maxY) + correction));
}

/** The correction that makes the base line pass through `userY` at `pos`. */
export function correctionFor(userY: number, pos: number, dur: number, maxY: number): number {
  'worklet';
  return userY - baseScroll(pos, dur, maxY);
}

const corrections = new Map<string, number>();
/** Per-song scroll correction, kept for the session. */
export const getCorrection = (songId: string | undefined): number => (songId ? (corrections.get(songId) ?? 0) : 0);
export function setCorrection(songId: string | undefined, c: number): void {
  if (songId) corrections.set(songId, c);
}
