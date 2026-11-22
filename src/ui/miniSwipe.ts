/** Mini player gesture: the dominant axis at gesture start decides (skip vs close), so the two never fire together. */
export type SwipeAxis = 'horizontal' | 'vertical';
export type SwipeEnd = 'skip-next' | 'skip-prev' | 'close' | 'none';

export const SKIP_DISTANCE = 70;
export const CLOSE_DISTANCE = 60;
export const CLOSE_VELOCITY = 800;
/** Movement (points) before an axis is chosen. */
export const LOCK_SLOP = 10;

/** Axis from the first movement; undefined until the finger moved `slop`. Ties go to horizontal (skip keeps working). */
export function lockAxis(dx: number, dy: number, slop = LOCK_SLOP): SwipeAxis | undefined {
  'worklet';
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return undefined;
  return Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
}

/** What a finished swipe does. Only downward travel closes (up is ignored); a fast downward fling closes even if short. */
export function swipeOutcome(axis: SwipeAxis | undefined, tx: number, ty: number, vy = 0): SwipeEnd {
  'worklet';
  if (axis === 'horizontal') return Math.abs(tx) > SKIP_DISTANCE ? (tx < 0 ? 'skip-next' : 'skip-prev') : 'none';
  if (axis === 'vertical') return ty > CLOSE_DISTANCE || (ty > 20 && vy > CLOSE_VELOCITY) ? 'close' : 'none';
  return 'none';
}
