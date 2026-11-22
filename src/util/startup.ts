import { Platform } from 'react-native';

/**
 * TV startup is deferred: the JS thread is the bottleneck for the first seconds, so background work that nobody is
 * waiting for (lyrics and stream prefetch of upcoming songs, the next song's palette, artwork prefetch) starts only a few
 * seconds after Home is interactive. Elsewhere everything is ready immediately.
 */
let ready = !Platform.isTV;
let timer: ReturnType<typeof setTimeout> | undefined;
const waiting: (() => void)[] = [];

export const startupReady = (): boolean => ready;

/** Runs `fn` now when startup is over, else once it is. */
export function whenStartupReady(fn: () => void): void {
  if (ready) fn();
  else waiting.push(fn);
}

/** Home is interactive: startup work is released after `delayMs`. Later calls are ignored. */
export function markInteractive(delayMs = 3000): void {
  if (ready || timer) return;
  timer = setTimeout(() => {
    ready = true;
    for (const f of waiting.splice(0)) {
      try {
        f();
      } catch {
        /* best effort */
      }
    }
  }, delayMs);
}
