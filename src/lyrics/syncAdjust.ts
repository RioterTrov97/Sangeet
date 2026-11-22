/** The lyrics sync control (phone pill, TV panel): step, limits and wording. Positive = the lyrics appear earlier. */
export const SYNC_STEP_MS = 500;
export const SYNC_MAX_MS = 30_000;

export type LyricsSync = { ms: number; uncertain: boolean; onChange: (ms: number) => void };

/** One step of the control; `dir` +1 = lyrics earlier, -1 = later. */
export const stepSync = (ms: number, dir: 1 | -1): number => Math.max(-SYNC_MAX_MS, Math.min(SYNC_MAX_MS, ms + dir * SYNC_STEP_MS));

/** The control is on screen while the timing is a guess or the user has adjusted it. */
export const syncVisible = (s: Pick<LyricsSync, 'ms' | 'uncertain'> | undefined): boolean => !!s && (s.uncertain || s.ms !== 0);

/** "May be out of sync" until the user adjusted, then the value (+ = earlier). */
export function syncLabel(ms: number): string {
  if (!ms) return 'May be out of sync';
  return `Sync ${ms > 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(1)} s`;
}
