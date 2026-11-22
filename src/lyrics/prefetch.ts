import { usePlayerStore } from '../player/store';
import { whenStartupReady } from '../util/startup';
import { prefetchLyrics } from './index';

/** Warms the lyrics cache for the current and next track whenever the queue position changes. */
export function startLyricsPrefetch(): void {
  let last = '';
  usePlayerStore.subscribe((s) => {
    const key = `${s.queue[s.index]?.id}|${s.queue[s.index + 1]?.id}`;
    if (key === last) return;
    last = key;
    const [cur, next] = [s.queue[s.index], s.queue[s.index + 1]];
    // On the TV this waits until a few seconds after Home is interactive.
    whenStartupReady(() => (prefetchLyrics(cur), prefetchLyrics(next)));
  });
}
