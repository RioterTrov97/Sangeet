/**
 * Tiny timing helper for the performance pass: `perfStart('x')` when something is asked for, `perfEnd('x', 'what')` when it
 * is on screen. Logs `[perf] x: what 123ms` (no data, only labels). Cheap enough to leave in; a no-op when the label has no start.
 */
const starts = new Map<string, number>();
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function perfStart(label: string): void {
  starts.set(label, now());
}

export function perfEnd(label: string, what: string, keep = false): void {
  const t = starts.get(label);
  if (t === undefined) return;
  if (!keep) starts.delete(label);
  console.log(`[perf] ${label}: ${what} ${Math.round(now() - t)}ms`);
}

/** Times a synchronous call. */
export function perfTime<T>(label: string, fn: () => T): T {
  const t = now();
  const r = fn();
  console.log(`[perf] ${label}: ${Math.round(now() - t)}ms`);
  return r;
}
