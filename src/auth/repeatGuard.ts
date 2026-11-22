/** The native player can announce one track change twice: a song counts again only after this long. */
export const REPEAT_MS = 30_000;

/** Returns a check that is true when `id` was just seen (same id within `windowMs`), and records it otherwise. */
export function repeatGuard(windowMs = REPEAT_MS): (id: string, now?: number) => boolean {
  let last: { id: string; at: number } | undefined;
  return (id, now = Date.now()) => {
    if (last?.id === id && now - last.at < windowMs) return true;
    last = { id, at: now };
    return false;
  };
}
