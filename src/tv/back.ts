/** Back-button interceptors, newest first: a screen's overlays (picker, Up next) close before the screen itself is left. */
const handlers: (() => boolean)[] = [];

export function pushBack(fn: () => boolean): () => void {
  handlers.push(fn);
  return () => {
    const i = handlers.indexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** True when an overlay consumed the Back press. */
export function runBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
  return false;
}
