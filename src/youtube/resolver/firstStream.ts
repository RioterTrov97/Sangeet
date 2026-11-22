let done = false;
/** `[perf] launch: first stream resolved Nms` once per process (N = this resolve, extractor start-up included), for scripts/tv-perf.sh. */
export function perfFirstStream(ms: number): void {
  if (done) return;
  done = true;
  console.log(`[perf] launch: first stream resolved ${Math.round(ms)}ms`);
}
