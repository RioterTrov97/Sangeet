let last = Date.now();
const recent: number[] = [];
/** Any user interaction (focus move, press, remote key); `isBrowsing` uses it to tell a lone focus event from real browsing. */
export const markActivity = () => {
  last = Date.now();
  recent.push(last);
  if (recent.length > 8) recent.shift();
};
export const idleMs = () => Date.now() - last;
/**
 * True while someone is really browsing on the TV: several D-pad events within the window. A lone focus event (the
 * screen putting focus on its first item as it mounts, e.g. on a cold launch) does not count.
 */
export const isBrowsing = (windowMs = 10_000, minEvents = 3): boolean => {
  const now = Date.now();
  return recent.filter((t) => now - t <= windowMs).length >= minEvents;
};

let wakeUntil = 0;
/** A remote command is starting playback while the app is not in the foreground and is bringing it forward: the AppState churn that follows must not pause it. */
export const noteRemoteWake = (ms = 10_000) => void (wakeUntil = Date.now() + ms);
export const remoteWakeActive = () => Date.now() < wakeUntil;
