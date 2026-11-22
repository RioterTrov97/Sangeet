import type { LrcLine, Lyrics } from './types';

/** Synced lyrics for a different edit of the song (music video with an intro, extended mix) drift by more than this. */
export const DURATION_TOLERANCE_S = 8;
/** Without a declared duration: synced text that ends this long before the audio does is not this version. */
export const MAX_TAIL_GAP_S = 60;

/**
 * Do these synced lyrics belong to a recording that is `playingSec` long?
 * Uses the duration the lyrics source declared (LRCLIB `duration`) when it has one: > 8 s apart = another version.
 * Otherwise compares the last timestamp with the length: lyrics cannot run past the end, nor stop a minute early.
 * Unknown lengths always fit.
 */
export function fitsDuration(synced: readonly LrcLine[] | undefined, lyricsDurationSec: number | undefined, playingSec: number | undefined): boolean {
  if (!synced?.length || !playingSec || playingSec <= 0) return true;
  if (lyricsDurationSec && lyricsDurationSec > 0) return Math.abs(lyricsDurationSec - playingSec) <= DURATION_TOLERANCE_S;
  const last = synced[synced.length - 1].time;
  return last <= playingSec + 3 && playingSec - last <= MAX_TAIL_GAP_S;
}

/** The lyrics as plain text, for when the timing cannot be trusted. */
export function toPlain(l: Lyrics): Lyrics {
  const plain = l.plain ?? (l.synced ?? []).map((x) => x.text).join('\n');
  const { synced: _drop, ...rest } = l;
  return { ...rest, plain };
}
