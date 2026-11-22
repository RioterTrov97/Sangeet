/**
 * A small queue that caps how many YouTube API calls run at once. Used on the TV only (a slow CPU parses many parallel
 * responses badly); the phone is unlimited. Now-Playing work (stream resolve, up-next, lyrics) is `high`: it starts at once
 * whatever the cap and the waiting `normal` calls go after it.
 */
export type Priority = 'high' | 'normal';

export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const pump = () => {
    while (running < max && waiting.length) waiting.shift()!();
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    running++;
    try {
      return await fn();
    } finally {
      running--;
      pump();
    }
  };
  return {
    /** Runs `fn` now (high) or when fewer than `max` calls are running (normal, first come first served). */
    limit<T>(fn: () => Promise<T>, priority: Priority = 'normal'): Promise<T> {
      if (priority === 'high' || (running < max && !waiting.length)) return run(fn);
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => void run(fn).then(resolve, reject));
      });
    },
    stats: () => ({ running, waiting: waiting.length }),
  };
}
